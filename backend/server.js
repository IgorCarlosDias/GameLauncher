const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { exec, execFile } = require("child_process");
const axios = require("axios");

const { getGameCover, searchGameCovers, testSteamGridDbKey } = require("./services/steamgriddb");
const { detectGameGenre, detectGenreFromLocalRules } = require("./services/genreDetector");
const supabaseSync = require("./services/supabaseSync");
const { wsManager } = require("./services/wsManager");
const { dbRun, dbGet, dbAll, initDatabase } = require("./database");
// Helper para carregar serviço de conquistas com resolução dinâmica sem travar em cache antigo
const getSteamAchievementsService = () => {
  try {
    const servicePath = require.resolve("./services/steamAchievements");
    delete require.cache[servicePath];
  } catch {}
  return require("./services/steamAchievements");
};
const detectLocalSteamUser = (...args) => getSteamAchievementsService().detectLocalSteamUser(...args);
const testSteamApiKey = (...args) => getSteamAchievementsService().testSteamApiKey(...args);
const getGameAchievementsFromDb = (...args) => getSteamAchievementsService().getGameAchievementsFromDb(...args);
const syncGameAchievements = (...args) => getSteamAchievementsService().syncGameAchievements(...args);


let ws = null;
try {
  ws = require("windows-shortcuts");
} catch {
  // Ignora caso windows-shortcuts não esteja instalado
}

function resolveShortcut(filePath) {
  return new Promise((resolve) => {
    if (!ws) return resolve(null);
    try {
      ws.query(filePath, (err, res) => {
        if (err || !res) return resolve(null);
        resolve(res);
      });
    } catch {
      resolve(null);
    }
  });
}

const app = express();

// =========================
// CONFIGURAÇÕES (via .env & Automação)
// =========================

let PORT = process.env.PORT || "3060";
let FRONTEND_PORT = process.env.FRONTEND_PORT || "8060";
let GAME_FOLDER = process.env.GAME_FOLDER || "";
let SERVER_IP = process.env.SERVER_IP || "127.0.0.1";
let API_TOKEN = (
  process.env.AUTH_TOKEN ||
  process.env.API_TOKEN ||
  process.env.VITE_API_TOKEN ||
  ""
).trim();

const ROOT_ENV_PATH = path.resolve(__dirname, "../.env");
const BACKEND_ENV_PATH = path.join(__dirname, ".env");
const FRONTEND_ENV_PATH = path.resolve(__dirname, "../frontend/.env");

// Se não houver AUTH_TOKEN / API_TOKEN configurado, gera um token seguro automaticamente
if (!API_TOKEN) {
  API_TOKEN = "gl_sec_" + crypto.randomBytes(16).toString("hex");
}
process.env.AUTH_TOKEN = API_TOKEN;
process.env.API_TOKEN = API_TOKEN;

function getAllowedSubnetPrefix() {
  const ip = (SERVER_IP || "192.168.0.204").trim();
  const parts = ip.split(".");
  if (parts.length === 4 && parts[0] !== "127") {
    return `${parts[0]}.${parts[1]}.${parts[2]}.`;
  }
  return "192.168.0.";
}

function isAllowedClientIp(rawIp) {
  if (!rawIp) return false;
  const cleanIp = String(rawIp).replace(/^::ffff:/i, "").trim();
  if (cleanIp === "127.0.0.1" || cleanIp === "::1" || cleanIp === "localhost") {
    return true;
  }
  const subnetPrefix = getAllowedSubnetPrefix();
  const isTailscale = () => {
    const match = cleanIp.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (!match) return false;
    const second = parseInt(match[1], 10);
    return second >= 64 && second <= 127;
  };
  return cleanIp.startsWith(subnetPrefix) || cleanIp.startsWith("192.168.0.") || isTailscale();
}

// 1. Filtro de Sub-rede (bloqueia qualquer IP fora de 192.168.0.0/24 e localhost)
app.use((req, res, next) => {
  const clientIp = req.socket?.remoteAddress || req.ip || "";
  if (!isAllowedClientIp(clientIp)) {
    console.warn(`[Segurança] Acesso bloqueado de IP fora da sub-rede autorizada: ${clientIp}`);
    return res.status(403).json({
      success: false,
      message: "Acesso negado: dispositivo fora da sub-rede local autorizada (192.168.0.0/24) ou da rede Tailscale.",
    });
  }
  next();
});

// 2. CORS restrito exclusivamente ao endereço do Frontend
function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const fePort = String(FRONTEND_PORT || "8060").trim();
    if (url.port && url.port !== fePort && url.port !== "8070" && url.port !== "8060") {
      return false;
    }
    const host = url.hostname;
    const srvIp = String(SERVER_IP || "192.168.0.204").trim();
    const subnetPrefix = getAllowedSubnetPrefix();
    const isTailscaleHost = () => {
      const match = host.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
      if (!match) return false;
      const second = parseInt(match[1], 10);
      return second >= 64 && second <= 127;
    };
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === srvIp ||
      host.startsWith(subnetPrefix) ||
      host.startsWith("192.168.0.") ||
      isTailscaleHost() ||
      host.endsWith(".ts.net")
    );
  } catch {
    return false;
  }
}


app.use(
  cors({
    origin: (origin, callback) => {
      // Requisições sem header Origin (ex: imagens estáticas ou chamadas diretas locais)
      // passam pelo CORS mas são barradas pelo requireApiToken nas rotas protegidas
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      console.warn(`[Segurança] Origem CORS bloqueada: ${origin}`);
      return callback(new Error("Origem não permitida pelo CORS do GameLauncher"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-token", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));

// Rate limiters para proteção contra abuso e conformidade com CodeQL
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/system/mouse",
});

const systemActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(apiLimiter);

// 3. Autenticação por Bearer Token (AUTH_TOKEN / API_TOKEN) para todos os endpoints REST
function verifyTokenTimingSafe(provided, expected) {
  if (!expected) return true;
  if (!provided || typeof provided !== "string") return false;
  const bufA = Buffer.from(provided.trim(), "utf8");
  const bufB = Buffer.from(expected.trim(), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractRequestToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  if (typeof req.headers["x-api-token"] === "string") {
    return req.headers["x-api-token"].trim();
  }
  if (typeof req.query?.token === "string") {
    return req.query.token.trim();
  }
  return "";
}

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();

  // Permite ping básico de disponibilidade (GET /) e arquivos estáticos de capa (/covers/*)
  if ((req.method === "GET" || req.method === "HEAD") && (req.path === "/" || req.path.startsWith("/covers/"))) {
    return next();
  }

  const candidateToken = extractRequestToken(req);

  if (!verifyTokenTimingSafe(candidateToken, API_TOKEN)) {
    console.warn(`[Segurança] 401 Unauthorized em ${req.method} ${req.path} (IP: ${req.socket?.remoteAddress})`);
    res.setHeader("WWW-Authenticate", 'Bearer realm="GameLauncher"');
    return res.status(401).json({
      success: false,
      code: "INVALID_API_TOKEN",
      message: "Não autorizado: Token Bearer de segurança inválido ou ausente.",
    });
  }

  next();
});

app.get("/auth/verify", (req, res) => {
  res.json({
    success: true,
    authenticated: true,
  });
});

// Logger de requisições (ignora spam de mousemove e polling frequente no console)
app.use((req, res, next) => {
  if (req.url !== "/system/mouse" && req.url !== "/system/active-game" && req.url !== "/system/stats" && req.url !== "/system/display") {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  }
  next();
});

const DEFAULT_AUTOMATION_SETTINGS = {
  autoDetectGames: true,
  monitorIntervalSec: 8,
  shutdownTimerSec: 30,
  defaultCloseMode: "force",
  touchpadSensitivity: 2.1,
  volumeStep: 3,
};

let automationSettings = { ...DEFAULT_AUTOMATION_SETTINGS };

const COVER_FOLDER = path.join(__dirname, "covers");
const SYSCONTROL_BIN = path.join(__dirname, "syscontrol.exe");
const PLAYTIME_JSON_PATH = path.join(__dirname, "playtime.json");

if (!fs.existsSync(COVER_FOLDER)) {
  fs.mkdirSync(COVER_FOLDER, { recursive: true });
}

const ALLOWED_SYSCONTROL_ACTIONS = new Set([
  "volup",
  "voldown",
  "volmute",
  "getvol",
  "setvol",
  "getaudiodevices",
  "setaudiodevice",
  "getdisplay",
  "setdisplay",
  "toggledisplay",
  "playpause",
  "next",
  "prev",
  "alttab",
  "altf4",
  "escape",
  "enter",
  "backspace",
  "space",
  "tab",
  "up",
  "down",
  "left",
  "right",
  "win",
  "wind",
  "mousemove",
  "mouseclick",
  "mousescroll",
  "typetext",
  "sleep",
  "killpid",
  "killname",
  "killforeground",
  "launch",
  "launchb64",
  "cursorpos",
  "deskinfo",
]);

function runSysControl(action, ...params) {
  return new Promise((resolve) => {
    const safeAction = String(action || "").toLowerCase();
    if (!ALLOWED_SYSCONTROL_ACTIONS.has(safeAction)) {
      return resolve("");
    }
    const args = [
      safeAction,
      ...params
        .filter((p) => p !== undefined && p !== null && p !== "")
        .map((p) => String(p)),
    ];
    execFile(
      SYSCONTROL_BIN,
      args,
      { encoding: "utf8", windowsHide: true },
      (err, stdout, stderr) => {
        resolve((stdout || stderr || "").trim());
      }
    );
  });
}

function findProcessPid(exeName) {
  return new Promise((resolve) => {
    if (!exeName) return resolve(null);
    const safeExe = path.basename(String(exeName));
    execFile(
      "tasklist.exe",
      ["/FI", `IMAGENAME eq ${safeExe}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const lines = stdout
          .trim()
          .split("\n")
          .filter((l) => l.toLowerCase().includes(safeExe.toLowerCase()));
        if (lines.length === 0) return resolve(null);
        const parts = lines[0].split(",").map((p) => p.replace(/"/g, "").trim());
        const pid = parseInt(parts[1], 10);
        resolve(pid || null);
      }
    );
  });
}

function isPidRunning(pid) {
  return new Promise((resolve) => {
    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0) return resolve(false);
    execFile(
      "tasklist.exe",
      ["/FI", `PID eq ${numericPid}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(false);
        resolve(stdout.includes(`"${numericPid}"`));
      }
    );
  });
}

// Monitoramento de CPU em tempo real via amostragem de ticks do Node os.cpus()
function getCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

let lastCpuTimes = getCpuTimes();
let currentCpuUsage = 0;

setInterval(() => {
  const current = getCpuTimes();
  const idleDiff = current.idle - lastCpuTimes.idle;
  const totalDiff = current.total - lastCpuTimes.total;
  if (totalDiff > 0) {
    currentCpuUsage = Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
  }
  lastCpuTimes = current;
}, 2500);

let games = [];
let activeGame = null;
const activeGames = new Map();

// =========================
// BUSCA ARQUIVOS RECURSIVO
// =========================

function scanFolder(folder) {
  let results = [];
  const items = fs.readdirSync(folder);

  for (const item of items) {
    const fullPath = path.join(folder, item);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(scanFolder(fullPath));
      } else {
        results.push(fullPath);
      }
    } catch {
      // Ignora arquivos sem permissão
    }
  }

  return results;
}

// =========================
// DOWNLOAD CAPA
// =========================

function sanitizeCoverName(name) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game"
  );
}

const ALLOWED_COVER_HOSTS = [
  "cdn2.steamgriddb.com",
  "cdn.steamgriddb.com",
  "www.steamgriddb.com",
  "cdn.cloudflare.steamstatic.com",
  "shared.akamai.steamstatic.com",
  "shared.fastly.steamstatic.com",
  "steamcdn-a.akamaihd.net",
  "avatars.steamstatic.com",
  "images.igdb.com",
  "i.imgur.com",
  "media.rawg.io",
  "upload.wikimedia.org",
  "raw.githubusercontent.com",
];

function buildSafeCoverUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  const safeHost = ALLOWED_COVER_HOSTS.find((h) => h === hostname);
  if (!safeHost) {
    return null;
  }
  if (!parsed.pathname || !parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) {
    return null;
  }
  return `https://${safeHost}${parsed.pathname}${parsed.search}`;
}

async function downloadCover(gameName, customImageUrl = null, forceOverwrite = false) {
  const baseSlug = sanitizeCoverName(gameName);
  const fileName = forceOverwrite ? `${baseSlug}-${Date.now()}.jpg` : `${baseSlug}.jpg`;
  const filePath = path.join(COVER_FOLDER, fileName);

  if (!forceOverwrite && fs.existsSync(filePath)) {
    return fileName;
  }

  const rawUrl = customImageUrl || (await getGameCover(gameName));
  const safeImageUrl = buildSafeCoverUrl(rawUrl);
  if (!safeImageUrl) {
    return null;
  }

  try {
    const response = await axios.get(safeImageUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
      maxRedirects: 3,
    });

    fs.writeFileSync(filePath, response.data);
    console.log(`Capa salva: ${gameName} (${fileName})`);
    return fileName;
  } catch (error) {
    console.log("Erro baixando capa:", error.message);
    return null;
  }
}

// =========================
// INTEGRAÇÃO DE TEMPO DE JOGO DA STEAM (localconfig.vdf)
// =========================

let cachedSteamInstallPath = null;
let steamVdfCache = { signature: "", map: new Map() };
let lastAppliedSteamSignature = "";

function getSteamInstallPath() {
  if (cachedSteamInstallPath && fs.existsSync(cachedSteamInstallPath)) {
    return Promise.resolve(cachedSteamInstallPath);
  }

  return new Promise((resolve) => {
    exec(
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
      { encoding: "utf8", windowsHide: true },
      (err, stdout) => {
        if (!err && stdout) {
          const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
          if (match) {
            const candidate = path.normalize(match[1].trim());
            if (fs.existsSync(candidate)) {
              cachedSteamInstallPath = candidate;
              return resolve(candidate);
            }
          }
        }

        const fallbacks = [
          "C:\\Program Files (x86)\\Steam",
          "C:\\Program Files\\Steam",
        ];
        for (const fb of fallbacks) {
          if (fs.existsSync(fb)) {
            cachedSteamInstallPath = fb;
            return resolve(fb);
          }
        }
        resolve(null);
      }
    );
  });
}

// Extrai Playtime (em minutos) e LastPlayed (timestamp Unix) da seção "apps" do localconfig.vdf
function parseSteamAppsPlaytime(vdfContent) {
  const result = new Map();
  const lines = vdfContent.split(/\r?\n/);
  const keyStack = [];
  let pendingKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//")) continue;

    if (line === "{") {
      keyStack.push(pendingKey || "");
      pendingKey = null;
      continue;
    }

    if (line === "}") {
      keyStack.pop();
      pendingKey = null;
      continue;
    }

    const kvMatch = line.match(/^"([^"]+)"\s+"([^"]*)"$/);
    if (kvMatch) {
      const k = kvMatch[1].toLowerCase();
      const v = kvMatch[2];
      const parentKey = keyStack[keyStack.length - 1] || "";
      const grandParentKey = (keyStack[keyStack.length - 2] || "").toLowerCase();

      if (grandParentKey === "apps" && /^\d+$/.test(parentKey)) {
        if (!result.has(parentKey)) {
          result.set(parentKey, { playtimeMinutes: 0, lastPlayedUnix: 0 });
        }
        const entry = result.get(parentKey);
        if (k === "playtime") {
          entry.playtimeMinutes = Math.max(entry.playtimeMinutes, parseInt(v, 10) || 0);
        } else if (k === "lastplayed") {
          entry.lastPlayedUnix = Math.max(entry.lastPlayedUnix, parseInt(v, 10) || 0);
        }
      }
      pendingKey = null;
      continue;
    }

    const keyMatch = line.match(/^"([^"]+)"$/);
    if (keyMatch) {
      pendingKey = keyMatch[1];
    }
  }

  return result;
}

// Lê todos os userdata/*/config/localconfig.vdf da Steam com cache por mtimeMs
async function getSteamPlaytimeMap(forceRead = false) {
  const steamPath = await getSteamInstallPath();
  if (!steamPath) return { signature: "", map: new Map() };

  const userdataDir = path.join(steamPath, "userdata");
  if (!fs.existsSync(userdataDir)) return { signature: "", map: new Map() };

  const vdfFiles = [];
  try {
    for (const userDir of fs.readdirSync(userdataDir)) {
      const vdfFile = path.join(userdataDir, userDir, "config", "localconfig.vdf");
      if (fs.existsSync(vdfFile)) {
        const stat = fs.statSync(vdfFile);
        vdfFiles.push({ file: vdfFile, mtimeMs: Math.floor(stat.mtimeMs) });
      }
    }
  } catch {
    return steamVdfCache;
  }

  if (vdfFiles.length === 0) return { signature: "", map: new Map() };

  const signature = vdfFiles.map((f) => `${f.file}:${f.mtimeMs}`).join("|");
  if (!forceRead && signature === steamVdfCache.signature) {
    return steamVdfCache;
  }

  const merged = new Map();
  for (const { file } of vdfFiles) {
    try {
      const content = fs.readFileSync(file, "utf8");
      const parsed = parseSteamAppsPlaytime(content);
      for (const [appId, data] of parsed) {
        if (!merged.has(appId)) {
          merged.set(appId, { ...data });
        } else {
          const cur = merged.get(appId);
          cur.playtimeMinutes = Math.max(cur.playtimeMinutes, data.playtimeMinutes);
          cur.lastPlayedUnix = Math.max(cur.lastPlayedUnix, data.lastPlayedUnix);
        }
      }
    } catch (err) {
      console.error("Erro lendo localconfig.vdf da Steam:", err.message);
    }
  }

  steamVdfCache = { signature, map: merged };
  return steamVdfCache;
}

// Sincroniza em memória + SQLite se o localconfig.vdf tiver sido atualizado pela Steam
async function syncSteamPlaytimesInMemory(force = false) {
  if (games.length === 0) return;

  const { signature, map: steamMap } = await getSteamPlaytimeMap(force);
  if (!signature || (!force && signature === lastAppliedSteamSignature)) return;
  lastAppliedSteamSignature = signature;

  let anyUpdated = false;
  for (const game of games) {
    if (!game.steamId) continue;
    if (activeGames.has(game.id) || (activeGame && activeGame.id === game.id)) continue;

    const st = steamMap.get(String(game.steamId));
    if (!st) continue;

    const steamSec = (st.playtimeMinutes || 0) * 60;
    const steamLastIso =
      st.lastPlayedUnix > 0 ? new Date(st.lastPlayedUnix * 1000).toISOString() : null;

    const curSec = Number(game.playTime) || 0;
    const nextSec = Math.max(curSec, steamSec);

    const curLastMs = game.lastPlayed ? new Date(game.lastPlayed).getTime() : 0;
    const steamLastMs = steamLastIso ? new Date(steamLastIso).getTime() : 0;
    const nextLast = steamLastMs > curLastMs ? steamLastIso : game.lastPlayed || null;
    const nextCount = nextSec > 0 ? Math.max(1, game.playCount || 0) : game.playCount || 0;

    if (nextSec !== curSec || nextLast !== game.lastPlayed || nextCount !== game.playCount) {
      game.playTime = nextSec;
      game.lastPlayed = nextLast;
      game.playCount = nextCount;
      anyUpdated = true;
      try {
        await dbRun(
          `UPDATE games SET play_time = ?, play_count = ?, last_played = ? WHERE id = ?`,
          [nextSec, nextCount, nextLast, game.id]
        );
      } catch (err) {
        console.error(`Erro sincronizando Steam para ${game.name}:`, err.message);
      }
    }
  }

  if (anyUpdated) {
    await savePlaytimeJson();
  }
}

// =========================
// DESCOBERTA DE EXECUTÁVEIS DO JOGO (INCLUINDO UNREAL *-Shipping.exe E LAUNCHERS)
// =========================

const IGNORED_SUBFOLDERS = new Set([
  "_commonredist",
  "redist",
  "directx",
  "vc",
  "support",
  "installer",
  "easyanticheat",
  "battleye",
  "unverum",
  "mods",
  "modmanager",
  "crashreporter",
]);

const IGNORED_HELPER_EXE_REGEX =
  /(unins|crash|redist|setup|dxsetup|vcredist|ue4prereq|ueprereq|unitycrash|easyanticheat|battleye|quicksfv|rapidcrc|fitgirl-launcher|installermessage|language[\s._-]*selector|language[\s._-]*changer|modmanager|updater|smartsteamloader|jfaddslots|quickbms|u4pak|umodel|elevate|dotnetprobe|windowsdesktop-runtime|gpu-capabilities|probe|protocolselector|gamingrepair|crs-handler|crs-video|pkhex|mymc|w9xpopen|cdztool|hedgemodmanager|trainer|qtwebengineprocess)/i;

function scanGameDirExecutables(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth || !dir) return [];
  let found = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_SUBFOLDERS.has(entry.name.toLowerCase())) continue;
      found = found.concat(scanGameDirExecutables(full, depth + 1, maxDepth));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) {
      if (!IGNORED_HELPER_EXE_REGEX.test(entry.name)) {
        found.push(entry.name);
      }
    }
  }
  return found;
}

function discoverGameExecutables(targetPath, fallbackExe) {
  const result = [];
  const addUnique = (exe) => {
    if (!exe || typeof exe !== "string") return;
    if (!exe.toLowerCase().endsWith(".exe")) return;
    if (!result.some((item) => item.toLowerCase() === exe.toLowerCase())) {
      result.push(exe);
    }
  };

  if (!targetPath || !fs.existsSync(targetPath)) {
    addUnique(fallbackExe);
    return result;
  }

  const primaryExe = path.basename(targetPath);
  const gameDir = path.dirname(targetPath);
  const dirExes = scanGameDirExecutables(gameDir, 0, 3);

  // 1. Prioriza binários reais da Unreal Engine (*-Shipping.exe)
  for (const exe of dirExes) {
    if (/-shipping\.exe$/i.test(exe)) {
      addUnique(exe);
    }
  }

  // 2. Adiciona o executável principal (se não for um launcher/instalador auxiliar)
  if (!IGNORED_HELPER_EXE_REGEX.test(primaryExe)) {
    addUnique(primaryExe);
  }

  // 3. Adiciona outros executáveis válidos encontrados na pasta do jogo
  for (const exe of dirExes) {
    addUnique(exe);
  }

  // 4. Garante que o executável principal esteja na lista como fallback
  addUnique(primaryExe);

  return result;
}

/**
 * Detecta automaticamente o Steam AppID de jogos locais
 * inspecionando steam_appid.txt e steam_emu.ini (RUNE, CODEX, Goldberg, Tenoke, etc.)
 */
function detectLocalSteamAppId(targetPath) {
  if (!targetPath || typeof targetPath !== "string") return null;
  try {
    if (!fs.existsSync(targetPath)) return null;
    const startDir = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
    const dirs = [startDir];
    let cur = startDir;

    // Sobe até 2 níveis para pegar diretórios pai (ex.: SparkingZERO/Binaries/Win64 -> raiz do jogo)
    for (let i = 0; i < 2; i++) {
      const parent = path.dirname(cur);
      if (parent && parent !== cur && path.dirname(parent) !== parent) {
        dirs.push(parent);
        cur = parent;
      }
    }

    // 1. Busca em startDir e pastas pai imediatas
    for (const dir of dirs) {
      const candidates = [
        path.join(dir, "steam_appid.txt"),
        path.join(dir, "steam_emu.ini"),
        path.join(dir, "steam_api64.ini"),
        path.join(dir, "steam_api.ini"),
        path.join(dir, "steam_settings", "steam_appid.txt"),
        path.join(dir, "steam_settings", "steam_api64.ini"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          try {
            const content = fs.readFileSync(c, "latin1");
            if (c.endsWith(".txt")) {
              const m = content.match(/\b(\d{3,9})\b/);
              if (m) return m[1];
            } else if (c.endsWith(".ini")) {
              const m = content.match(/AppId\s*=\s*(\d+)/i);
              if (m) return m[1];
            }
          } catch {}
        }
      }
    }

    // 2. Busca recursiva em subpastas diretas (até 4 níveis: Binaries/Win64, Engine, etc.)
    const checkSubdirs = (parentDir, depth = 0) => {
      if (depth > 4 || !fs.existsSync(parentDir)) return null;
      try {
        const entries = fs.readdirSync(parentDir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isFile()) {
            const lowerName = ent.name.toLowerCase();
            if (
              lowerName === "steam_appid.txt" ||
              lowerName === "steam_emu.ini" ||
              lowerName === "steam_api64.ini" ||
              lowerName === "steam_api.ini"
            ) {
              const full = path.join(parentDir, ent.name);
              const content = fs.readFileSync(full, "latin1");
              if (lowerName.endsWith(".txt")) {
                const m = content.match(/\b(\d{3,9})\b/);
                if (m) return m[1];
              } else {
                const m = content.match(/AppId\s*=\s*(\d+)/i);
                if (m) return m[1];
              }
            }
          } else if (
            ent.isDirectory() &&
            !["node_modules", ".git", "$recycle.bin", "saved", "intermediate", "temp"].includes(ent.name.toLowerCase())
          ) {
            const found = checkSubdirs(path.join(parentDir, ent.name), depth + 1);
            if (found) return found;
          }
        }
      } catch {}
      return null;
    };

    const rootDir = dirs[dirs.length - 1] || startDir;
    return checkSubdirs(startDir) || checkSubdirs(rootDir);
  } catch {
    return null;
  }
}

// =========================
// PERSISTÊNCIA, EXPORTAÇÃO E IMPORTAÇÃO DE TEMPOS EM JSON (playtime.json)
// =========================

function formatDurationText(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total === 0) return "0m";
  if (total < 60) return `${total}s`;
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

function parseHumanDuration(val) {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.max(0, Math.round(val));
  }
  if (typeof val !== "string") return null;
  const trimmed = val.trim().slice(0, 64).toLowerCase();
  if (!trimmed) return null;

  const directNum = Number(trimmed);
  if (Number.isInteger(directNum) && !trimmed.includes(" ")) {
    return Math.max(0, directNum);
  }

  let total = 0;
  let matched = false;
  let numBuf = "";
  const len = trimmed.length;

  for (let i = 0; i < len; i++) {
    const ch = trimmed[i];
    if ((ch >= "0" && ch <= "9") || ch === "." || ch === ",") {
      numBuf += ch === "," ? "." : ch;
      continue;
    }
    if (ch === " ") {
      continue;
    }
    if (numBuf) {
      const parsed = parseFloat(numBuf);
      numBuf = "";
      if (Number.isFinite(parsed)) {
        if (ch === "h") {
          total += Math.round(parsed * 3600);
          matched = true;
        } else if (ch === "m" && trimmed[i + 1] !== "s") {
          total += Math.round(parsed * 60);
          matched = true;
        } else if (ch === "s") {
          total += Math.round(parsed);
          matched = true;
        }
      }
    }
  }

  return matched ? Math.max(0, total) : null;
}

async function getMeta(key, defaultVal = null) {
  try {
    const row = await dbGet("SELECT value FROM app_meta WHERE key = ?", [key]);
    return row ? row.value : defaultVal;
  } catch {
    return defaultVal;
  }
}

async function setMeta(key, value) {
  try {
    await dbRun(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, String(value)]
    );
  } catch (err) {
    console.error("Erro salvando app_meta:", err.message);
  }
}

function normalizeAutomationSettings(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const autoDetectGames =
    src.autoDetectGames !== undefined
      ? Boolean(src.autoDetectGames)
      : automationSettings.autoDetectGames;

  const monitorSecRaw = Number(src.monitorIntervalSec ?? automationSettings.monitorIntervalSec);
  const monitorIntervalSec = Number.isFinite(monitorSecRaw)
    ? Math.max(3, Math.min(60, Math.round(monitorSecRaw)))
    : DEFAULT_AUTOMATION_SETTINGS.monitorIntervalSec;

  const shutdownSecRaw = Number(src.shutdownTimerSec ?? automationSettings.shutdownTimerSec);
  const shutdownTimerSec = Number.isFinite(shutdownSecRaw)
    ? Math.max(5, Math.min(3600, Math.round(shutdownSecRaw)))
    : DEFAULT_AUTOMATION_SETTINGS.shutdownTimerSec;

  const defaultCloseMode =
    src.defaultCloseMode === "soft" || src.defaultCloseMode === "force"
      ? src.defaultCloseMode
      : automationSettings.defaultCloseMode || "force";

  const sensRaw = Number(src.touchpadSensitivity ?? automationSettings.touchpadSensitivity);
  const touchpadSensitivity = Number.isFinite(sensRaw)
    ? Math.round(Math.max(0.5, Math.min(5.0, sensRaw)) * 10) / 10
    : DEFAULT_AUTOMATION_SETTINGS.touchpadSensitivity;

  const volStepRaw = Number(src.volumeStep ?? automationSettings.volumeStep);
  const volumeStep = Number.isFinite(volStepRaw)
    ? Math.max(1, Math.min(20, Math.round(volStepRaw)))
    : DEFAULT_AUTOMATION_SETTINGS.volumeStep;

  return {
    autoDetectGames,
    monitorIntervalSec,
    shutdownTimerSec,
    defaultCloseMode,
    touchpadSensitivity,
    volumeStep,
  };
}

async function loadAutomationSettings() {
  try {
    const rawJson = await getMeta("automation_settings", null);
    if (rawJson) {
      const parsed = JSON.parse(rawJson);
      automationSettings = normalizeAutomationSettings(parsed);
    }
  } catch (err) {
    console.error("Aviso ao carregar automation_settings:", err.message);
  }
  return automationSettings;
}

async function saveAutomationSettings(partial = {}) {
  const prevInterval = automationSettings.monitorIntervalSec;
  automationSettings = normalizeAutomationSettings({
    ...automationSettings,
    ...partial,
  });
  await setMeta("automation_settings", JSON.stringify(automationSettings));
  if (
    prevInterval !== automationSettings.monitorIntervalSec &&
    typeof restartActiveGameMonitor === "function"
  ) {
    restartActiveGameMonitor();
  }
  return automationSettings;
}

function getLocalNetworkAddresses() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const [name, interfaces] of Object.entries(nets)) {
    if (!Array.isArray(interfaces)) continue;
    for (const iface of interfaces) {
      if (iface && (iface.family === "IPv4" || iface.family === 4) && !iface.internal) {
        list.push({
          name,
          address: iface.address,
        });
      }
    }
  }
  return list;
}

function inspectGameFolder(candidatePath) {
  const raw = String(candidatePath || "").trim();
  if (!raw) {
    return {
      valid: false,
      exists: false,
      path: "",
      totalGames: 0,
      counts: { exe: 0, lnk: 0, url: 0 },
      message: "Caminho da pasta de jogos vazio.",
    };
  }

  try {
    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved)) {
      return {
        valid: false,
        exists: false,
        path: resolved,
        totalGames: 0,
        counts: { exe: 0, lnk: 0, url: 0 },
        message: "A pasta informada não existe neste computador.",
      };
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return {
        valid: false,
        exists: true,
        path: resolved,
        totalGames: 0,
        counts: { exe: 0, lnk: 0, url: 0 },
        message: "O caminho informado não é um diretório.",
      };
    }

    const files = scanFolder(resolved);
    const counts = { exe: 0, lnk: 0, url: 0 };
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (ext === ".exe") counts.exe += 1;
      else if (ext === ".lnk") counts.lnk += 1;
      else if (ext === ".url") counts.url += 1;
    }
    const totalGames = counts.exe + counts.lnk + counts.url;

    return {
      valid: true,
      exists: true,
      path: resolved,
      totalGames,
      counts,
      message:
        totalGames > 0
          ? `Pasta válida! ${totalGames} jogo(s) compatível(is) encontrado(s).`
          : "Pasta encontrada, porém nenhum arquivo .exe, .lnk ou .url foi localizado nela.",
    };
  } catch (err) {
    return {
      valid: false,
      exists: false,
      path: raw,
      totalGames: 0,
      counts: { exe: 0, lnk: 0, url: 0 },
      message: "Erro ao verificar pasta: " + err.message,
    };
  }
}

function sanitizeEnvValue(val) {
  return String(val ?? "")
    .replace(/[\r\n]/g, "")
    .trim();
}

function maskSecretHint(secret) {
  const s = String(secret || "").trim();
  if (!s) return "";
  if (s.length <= 4) return "••••••••";
  return `••••••••${s.slice(-4)}`;
}

function persistEnvFiles({
  serverIp,
  port,
  frontendPort,
  gameFolder,
  steamGridDbKey,
  steamApiKey,
  steamUserId,
  supabaseUrl,
  supabaseKey,
  supabaseEmail,
  supabasePassword,
  apiToken,
}) {
  const cleanIp = sanitizeEnvValue(serverIp || SERVER_IP || "127.0.0.1");
  const cleanPort = String(Math.max(1, Math.min(65535, parseInt(port || PORT, 10) || 3060)));
  const cleanFrontendPort = String(
    Math.max(1, Math.min(65535, parseInt(frontendPort || FRONTEND_PORT, 10) || 8060))
  );
  const cleanFolder = sanitizeEnvValue(gameFolder !== undefined ? gameFolder : GAME_FOLDER);
  const cleanKey = sanitizeEnvValue(
    steamGridDbKey !== undefined && String(steamGridDbKey).trim() !== ""
      ? steamGridDbKey
      : process.env.STEAMGRIDDB_KEY || ""
  );
  const cleanSteamApiKey = sanitizeEnvValue(
    steamApiKey !== undefined && String(steamApiKey).trim() !== ""
      ? steamApiKey
      : (steamApiKey === "" ? "" : process.env.STEAM_API_KEY || "")
  );
  const cleanSteamUserId = sanitizeEnvValue(
    steamUserId !== undefined ? steamUserId : process.env.STEAM_USER_ID || ""
  );
  const cleanSupabaseUrl = sanitizeEnvValue(
    supabaseUrl !== undefined ? supabaseUrl : process.env.SUPABASE_URL || ""
  );
  const cleanSupabaseKey = sanitizeEnvValue(
    supabaseKey !== undefined && String(supabaseKey).trim() !== ""
      ? supabaseKey
      : process.env.SUPABASE_KEY || ""
  );
  const cleanSupabaseEmail = sanitizeEnvValue(
    supabaseEmail !== undefined ? supabaseEmail : process.env.SUPABASE_EMAIL || ""
  );
  const cleanSupabasePassword = sanitizeEnvValue(
    supabasePassword !== undefined && String(supabasePassword).trim() !== ""
      ? supabasePassword
      : process.env.SUPABASE_PASSWORD || ""
  );
  const cleanApiToken = sanitizeEnvValue(
    apiToken !== undefined && String(apiToken).trim() !== ""
      ? apiToken
      : API_TOKEN || process.env.API_TOKEN || ""
  );
  const apiUrl = `http://${cleanIp}:${cleanPort}`;

  const rootEnvContent = [
    "# ===========================================",
    "# CONFIGURACAO CENTRAL DO GAMELAUNCHER",
    "# ===========================================",
    "",
    "# IP da maquina na rede local",
    `SERVER_IP=${cleanIp}`,
    "",
    "# Portas do Backend (API) e Frontend (Interface Web)",
    `PORT=${cleanPort}`,
    `FRONTEND_PORT=${cleanFrontendPort}`,
    "",
    "# Variaveis automaticas para o Vite (Frontend)",
    `VITE_SERVER_IP=${cleanIp}`,
    `VITE_PORT=${cleanFrontendPort}`,
    `VITE_API_PORT=${cleanPort}`,
    `VITE_API_URL=${apiUrl}`,
    "",
    "# Pasta de Jogos e Chave da API de Capas",
    `GAME_FOLDER=${cleanFolder}`,
    `STEAMGRIDDB_KEY=${cleanKey}`,
    "",
    "# Integracao Steam Web API (Conquistas e Estatisticas)",
    `STEAM_API_KEY=${cleanSteamApiKey}`,
    `STEAM_USER_ID=${cleanSteamUserId}`,
    "",
    "# Supabase Cloud Sync",
    `SUPABASE_URL=${cleanSupabaseUrl}`,
    `SUPABASE_KEY=${cleanSupabaseKey}`,
    `SUPABASE_EMAIL=${cleanSupabaseEmail}`,
    `SUPABASE_PASSWORD=${cleanSupabasePassword}`,
    "",
    "# Seguranca da API (Token Bearer exigido em todas as rotas e WebSocket)",
    `AUTH_TOKEN=${cleanApiToken}`,
    `API_TOKEN=${cleanApiToken}`,
    `VITE_API_TOKEN=${cleanApiToken}`,
    "",
  ].join("\n");

  const backendEnvContent = [
    `STEAMGRIDDB_KEY=${cleanKey}`,
    `STEAM_API_KEY=${cleanSteamApiKey}`,
    `STEAM_USER_ID=${cleanSteamUserId}`,
    `SERVER_IP=${cleanIp}`,
    `PORT=${cleanPort}`,
    `FRONTEND_PORT=${cleanFrontendPort}`,
    `GAME_FOLDER=${cleanFolder}`,
    `SUPABASE_URL=${cleanSupabaseUrl}`,
    `SUPABASE_KEY=${cleanSupabaseKey}`,
    `SUPABASE_EMAIL=${cleanSupabaseEmail}`,
    `SUPABASE_PASSWORD=${cleanSupabasePassword}`,
    `AUTH_TOKEN=${cleanApiToken}`,
    `API_TOKEN=${cleanApiToken}`,
    "",
  ].join("\n");

  const frontendEnvContent = [
    `VITE_SERVER_IP=${cleanIp}`,
    `VITE_PORT=${cleanFrontendPort}`,
    `VITE_API_PORT=${cleanPort}`,
    `VITE_API_URL=${apiUrl}`,
    `VITE_API_TOKEN=${cleanApiToken}`,
    "",
  ].join("\n");

  fs.writeFileSync(ROOT_ENV_PATH, rootEnvContent, "utf8");
  fs.writeFileSync(BACKEND_ENV_PATH, backendEnvContent, "utf8");
  if (fs.existsSync(path.dirname(FRONTEND_ENV_PATH))) {
    fs.writeFileSync(FRONTEND_ENV_PATH, frontendEnvContent, "utf8");
  }

  process.env.SERVER_IP = cleanIp;
  process.env.PORT = cleanPort;
  process.env.FRONTEND_PORT = cleanFrontendPort;
  process.env.GAME_FOLDER = cleanFolder;
  process.env.STEAMGRIDDB_KEY = cleanKey;
  process.env.STEAM_API_KEY = cleanSteamApiKey;
  process.env.STEAM_USER_ID = cleanSteamUserId;
  process.env.SUPABASE_URL = cleanSupabaseUrl;
  process.env.SUPABASE_KEY = cleanSupabaseKey;
  process.env.SUPABASE_EMAIL = cleanSupabaseEmail;
  process.env.SUPABASE_PASSWORD = cleanSupabasePassword;
  process.env.AUTH_TOKEN = cleanApiToken;
  process.env.API_TOKEN = cleanApiToken;

  SERVER_IP = cleanIp;
  PORT = cleanPort;
  FRONTEND_PORT = cleanFrontendPort;
  GAME_FOLDER = cleanFolder;
  API_TOKEN = cleanApiToken;

  if (typeof supabaseSync?.resetClient === "function") {
    supabaseSync.resetClient();
  }

  return {
    serverIp: cleanIp,
    port: Number(cleanPort),
    frontendPort: Number(cleanFrontendPort),
    gameFolder: cleanFolder,
    hasSteamGridDbKey: Boolean(cleanKey),
    steamGridDbKeyHint: maskSecretHint(cleanKey),
    hasSteamApiKey: Boolean(cleanSteamApiKey),
    steamApiKeyHint: maskSecretHint(cleanSteamApiKey),
    steamUserId: cleanSteamUserId,
    supabaseUrl: cleanSupabaseUrl,
    hasSupabaseKey: Boolean(cleanSupabaseKey),
    supabaseKeyHint: maskSecretHint(cleanSupabaseKey),
    supabaseEmail: cleanSupabaseEmail,
    hasSupabasePassword: Boolean(cleanSupabasePassword),
    hasApiToken: Boolean(cleanApiToken),
    apiTokenHint: maskSecretHint(cleanApiToken),
    apiUrl,
    _internalKeyChanged: cleanKey,
  };
}

async function buildPlaytimePayload() {
  const dbGames = await dbAll("SELECT * FROM games");
  const dbSessions = await dbAll(
    `SELECT s.*, g.name AS db_game_name, g.custom_name AS db_custom_name, g.path AS db_game_path
     FROM sessions s
     LEFT JOIN games g ON s.game_id = g.id
     ORDER BY s.id ASC`
  );
  const dbAchievements = await dbAll(
    `SELECT a.*, g.name AS db_game_name, g.custom_name AS db_custom_name, g.path AS db_game_path, g.steam_id AS db_steam_id
     FROM achievements a
     LEFT JOIN games g ON a.game_id = g.id
     ORDER BY a.game_id ASC, a.id ASC`
  ).catch(() => []);

  const achStatsByGameId = new Map();
  for (const a of dbAchievements) {
    const cur = achStatsByGameId.get(a.game_id) || { total: 0, unlocked: 0 };
    cur.total += 1;
    if (a.achieved === 1) cur.unlocked += 1;
    achStatsByGameId.set(a.game_id, cur);
  }

  const memById = new Map(games.map((g) => [g.id, g]));
  const mergedGames = dbGames.map((row) => {
    const mem = memById.get(row.id);
    const playTime = mem ? Number(mem.playTime) || 0 : Number(row.play_time) || 0;
    const playCount = mem ? Number(mem.playCount) || 0 : Number(row.play_count) || 0;
    const favorite = mem ? Boolean(mem.favorite) : Boolean(row.favorite);
    const lastPlayed = (mem ? mem.lastPlayed : row.last_played) || null;
    const customName = (mem ? mem.customName : row.custom_name) || null;
    const originalName = row.name || mem?.originalName || "";
    const displayName = customName || originalName;
    const genre =
      (mem ? mem.genre : row.genre) ||
      detectGenreFromLocalRules({
        name: displayName,
        originalName,
        resolvedExe: row.resolved_exe,
      }) ||
      null;
    const achStats = achStatsByGameId.get(row.id) || { total: 0, unlocked: 0 };

    return {
      id: row.id,
      name: displayName,
      originalName,
      customName,
      genre,
      path: row.path,
      extension: row.extension,
      resolvedExe: row.resolved_exe,
      steamId: row.steam_id || null,
      cover: row.cover || null,
      favorite,
      playTime,
      playTimeFormatted: formatDurationText(playTime),
      playCount,
      lastPlayed,
      achievementsTotal: achStats.total,
      achievementsUnlocked: achStats.unlocked,
    };
  });

  mergedGames.sort((a, b) => {
    if (a.playTime !== b.playTime) return b.playTime - a.playTime;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });

  const formattedSessions = dbSessions.map((s) => {
    const duration = Number(s.duration) || 0;
    const gameName = s.db_custom_name || s.db_game_name || `Jogo #${s.game_id}`;
    return {
      id: s.id,
      gameId: s.game_id,
      gameName,
      gameOriginalName: s.db_game_name || gameName,
      gamePath: s.db_game_path || null,
      startedAt: s.started_at || null,
      endedAt: s.ended_at || null,
      duration,
      durationFormatted: formatDurationText(duration),
    };
  });

  const formattedAchievements = dbAchievements.map((a) => {
    const gameName = a.db_custom_name || a.db_game_name || `Jogo #${a.game_id}`;
    return {
      gameId: a.game_id,
      gameName,
      gameOriginalName: a.db_game_name || gameName,
      gamePath: a.db_game_path || null,
      steamId: a.steam_id || a.db_steam_id || null,
      apiName: a.api_name,
      name: a.name,
      description: a.description || "",
      iconUrl: a.icon_url || "",
      iconGrayUrl: a.icon_gray_url || "",
      hidden: Boolean(a.hidden),
      achieved: Boolean(a.achieved),
      unlockTime: Number(a.unlock_time) || 0,
      updatedAt: a.updated_at || null,
    };
  });

  const totalAchievementsCount = formattedAchievements.length;
  const unlockedAchievementsCount = formattedAchievements.filter((a) => a.achieved).length;

  const gamesPlayTimeSeconds = mergedGames.reduce((acc, g) => acc + (Number(g.playTime) || 0), 0);
  const sessionsTotalDurationSeconds = formattedSessions.reduce(
    (acc, s) => acc + (Number(s.duration) || 0),
    0
  );
  const couchOffsetRaw = await getMeta("couch_time_offset", "0");
  const couchTimeOffsetSeconds = parseInt(couchOffsetRaw, 10) || 0;
  const couchTimeSeconds = Math.max(0, gamesPlayTimeSeconds + couchTimeOffsetSeconds);

  let activeSessionSeconds = 0;
  for (const ag of activeGames.values()) {
    if (ag.startedAt) {
      const diff = Math.floor((Date.now() - new Date(ag.startedAt).getTime()) / 1000);
      if (diff > 0) activeSessionSeconds += diff;
    }
  }

  const totalPlayCount = mergedGames.reduce((acc, g) => acc + (Number(g.playCount) || 0), 0);
  const playedGames = mergedGames.filter((g) => g.playTime > 0);
  const topGame = playedGames[0] || null;

  let lastPlayedAt = null;
  let lastPlayedGame = null;
  for (const g of mergedGames) {
    if (!g.lastPlayed) continue;
    if (!lastPlayedAt || new Date(g.lastPlayed).getTime() > new Date(lastPlayedAt).getTime()) {
      lastPlayedAt = g.lastPlayed;
      lastPlayedGame = {
        id: g.id,
        name: g.name,
        lastPlayed: g.lastPlayed,
        playTimeSeconds: g.playTime,
        playTimeFormatted: g.playTimeFormatted,
      };
    }
  }

  return {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    summary: {
      couchTimeSeconds,
      couchTimeFormatted: formatDurationText(couchTimeSeconds),
      couchTimeOffsetSeconds,
      gamesPlayTimeSeconds,
      gamesPlayTimeFormatted: formatDurationText(gamesPlayTimeSeconds),
      sessionsTotalDurationSeconds,
      sessionsTotalDurationFormatted: formatDurationText(sessionsTotalDurationSeconds),
      activeSessionSeconds,
      activeSessionFormatted: formatDurationText(activeSessionSeconds),
      totalPlayCount,
      totalSessionsRecorded: formattedSessions.length,
      totalGames: mergedGames.length,
      playedGamesCount: playedGames.length,
      unplayedGamesCount: mergedGames.length - playedGames.length,
      favoritesCount: mergedGames.filter((g) => g.favorite).length,
      totalAchievements: totalAchievementsCount,
      unlockedAchievements: unlockedAchievementsCount,
      lastPlayedAt,
      lastPlayedGame,
      mostPlayedGame: topGame
        ? {
            id: topGame.id,
            name: topGame.name,
            playTimeSeconds: topGame.playTime,
            playTimeFormatted: topGame.playTimeFormatted,
            playCount: topGame.playCount,
            lastPlayed: topGame.lastPlayed,
          }
        : null,
    },
    games: mergedGames,
    sessions: formattedSessions,
    achievements: formattedAchievements,
  };
}

async function savePlaytimeJson() {
  try {
    const payload = await buildPlaytimePayload();
    const jsonString = JSON.stringify(payload, null, 2);
    fs.writeFileSync(PLAYTIME_JSON_PATH, jsonString, "utf8");
    const hash = crypto.createHash("sha256").update(jsonString).digest("hex");
    await setMeta("last_json_hash", hash);
    await setMeta("last_json_sync", payload.updatedAt);

    // Auto-sync em background para o Supabase (silencioso)
    if (typeof supabaseSync?.pushPlaytimeToSupabase === "function") {
      supabaseSync.pushPlaytimeToSupabase(payload).catch((err) => {
        console.warn("[Supabase] Auto-sync em background:", err.message);
      });
    }

    return payload;
  } catch (err) {
    console.error("Erro salvando playtime.json:", err.message);
    return null;
  }
}

function resolveImportedDuration(rawVal, formattedVal, existingSec) {
  let sec =
    typeof rawVal === "number" && Number.isFinite(rawVal)
      ? Math.max(0, Math.round(rawVal))
      : parseHumanDuration(rawVal);

  if (typeof formattedVal === "string") {
    const fromFmt = parseHumanDuration(formattedVal);
    if (fromFmt !== null) {
      if (sec === null) {
        sec = fromFmt;
      } else if (
        formatDurationText(sec).toLowerCase() !== formattedVal.trim().toLowerCase() &&
        fromFmt !== sec &&
        (existingSec === undefined || sec === existingSec)
      ) {
        // Caso o usuário tenha editado o campo *Formatted manualmente no JSON
        sec = fromFmt;
      }
    }
  }
  return sec;
}

function matchGameRecord(item, dbGames) {
  const itemPath = String(item.path || item.file || "").trim().toLowerCase();
  const itemSteam = item.steamId || item.steam_id ? String(item.steamId || item.steam_id).trim() : "";
  const itemOrig = String(item.originalName || item.name || "").trim().toLowerCase();
  const itemName = String(item.name || item.customName || item.custom_name || "").trim().toLowerCase();
  const itemExe = String(item.resolvedExe || item.resolved_exe || "").trim().toLowerCase();

  if (itemPath) {
    const byPath = dbGames.find((g) => String(g.path || "").toLowerCase() === itemPath);
    if (byPath) return byPath;
  }
  if (itemSteam) {
    const bySteam = dbGames.find((g) => g.steam_id && String(g.steam_id) === itemSteam);
    if (bySteam) return bySteam;
  }
  if (itemOrig) {
    const byOrig = dbGames.find(
      (g) =>
        String(g.name || "").toLowerCase() === itemOrig ||
        String(g.custom_name || "").toLowerCase() === itemOrig
    );
    if (byOrig) return byOrig;
  }
  if (itemName) {
    const byName = dbGames.find(
      (g) =>
        String(g.custom_name || "").toLowerCase() === itemName ||
        String(g.name || "").toLowerCase() === itemName
    );
    if (byName) return byName;
  }
  if (itemExe && itemExe.endsWith(".exe")) {
    const byExe = dbGames.filter((g) => String(g.resolved_exe || "").toLowerCase() === itemExe);
    if (byExe.length === 1) return byExe[0];
  }
  return null;
}

async function importPlaytimeData(rawPayload, mode = "merge", options = { saveToJson: true }) {
  if (!rawPayload || typeof rawPayload !== "object") {
    throw new Error("Formato de JSON inválido.");
  }

  const normalizedMode = mode === "replace" ? "replace" : "merge";
  const incomingGames = Array.isArray(rawPayload.games)
    ? rawPayload.games
    : Array.isArray(rawPayload)
    ? rawPayload
    : [];
  const incomingSessions = Array.isArray(rawPayload.sessions) ? rawPayload.sessions : [];
  const incomingAchievements = Array.isArray(rawPayload.achievements) ? rawPayload.achievements : [];
  const incomingSummary =
    rawPayload.summary && typeof rawPayload.summary === "object" ? rawPayload.summary : null;

  if (
    incomingGames.length === 0 &&
    incomingSessions.length === 0 &&
    incomingAchievements.length === 0 &&
    !incomingSummary
  ) {
    throw new Error("O arquivo JSON não contém dados de jogos, sessões, conquistas ou tempo de sofá.");
  }

  let dbGames = await dbAll("SELECT * FROM games");
  const oldIdToNewId = new Map();
  let matchedGamesCount = 0;
  let updatedGamesCount = 0;
  let insertedGamesCount = 0;

  for (const item of incomingGames) {
    if (!item || typeof item !== "object") continue;

    const matched = matchGameRecord(item, dbGames);
    const existingSec = matched ? Number(matched.play_time) || 0 : undefined;
    const resolvedSec = resolveImportedDuration(
      item.playTime ?? item.play_time,
      item.playTimeFormatted,
      existingSec
    );
    const rawCount = item.playCount ?? item.play_count;
    const resolvedCount =
      typeof rawCount === "number" && Number.isFinite(rawCount)
        ? Math.max(0, Math.round(rawCount))
        : null;
    const resolvedLast = item.lastPlayed ?? item.last_played ?? null;
    const hasLastField = "lastPlayed" in item || "last_played" in item;
    const hasFavField = "favorite" in item;
    const resolvedFav = hasFavField ? Boolean(item.favorite) : undefined;
    const hasCustomName = "customName" in item || "custom_name" in item;
    const resolvedCustomName = hasCustomName
      ? String(item.customName ?? item.custom_name ?? "").trim() || null
      : undefined;
    const hasGenre = "genre" in item;
    const resolvedGenre = hasGenre
      ? String(item.genre ?? "").trim() || null
      : undefined;

    if (matched) {
      matchedGamesCount++;
      if (item.id !== undefined) {
        oldIdToNewId.set(Number(item.id), matched.id);
      }

      let nextPlayTime = Number(matched.play_time) || 0;
      let nextPlayCount = Number(matched.play_count) || 0;
      let nextLastPlayed = matched.last_played || null;
      let nextFav = Boolean(matched.favorite);
      let nextCustomName = matched.custom_name || null;
      let nextGenre = matched.genre || null;

      if (normalizedMode === "replace") {
        if (resolvedSec !== null) nextPlayTime = resolvedSec;
        if (resolvedCount !== null) nextPlayCount = resolvedCount;
        else if (nextPlayTime === 0) nextPlayCount = 0;
        if (hasLastField) nextLastPlayed = resolvedLast || null;
        if (resolvedFav !== undefined) nextFav = resolvedFav;
        if (resolvedCustomName !== undefined) nextCustomName = resolvedCustomName;
        if (resolvedGenre !== undefined) nextGenre = resolvedGenre;
      } else {
        if (resolvedSec !== null) nextPlayTime = Math.max(nextPlayTime, resolvedSec);
        if (resolvedCount !== null) nextPlayCount = Math.max(nextPlayCount, resolvedCount);
        else if (nextPlayTime > 0 && nextPlayCount === 0) nextPlayCount = 1;

        if (resolvedLast) {
          const curMs = nextLastPlayed ? new Date(nextLastPlayed).getTime() : 0;
          const incMs = new Date(resolvedLast).getTime();
          if (Number.isFinite(incMs) && incMs > curMs) {
            nextLastPlayed = new Date(incMs).toISOString();
          }
        }
        if (resolvedFav) nextFav = true;
        if (!nextCustomName && resolvedCustomName) nextCustomName = resolvedCustomName;
        if (!nextGenre && resolvedGenre) nextGenre = resolvedGenre;
      }

      await dbRun(
        `UPDATE games SET play_time = ?, play_count = ?, last_played = ?, favorite = ?, custom_name = ?, genre = ? WHERE id = ?`,
        [nextPlayTime, nextPlayCount, nextLastPlayed, nextFav ? 1 : 0, nextCustomName, nextGenre, matched.id]
      );

      matched.play_time = nextPlayTime;
      matched.play_count = nextPlayCount;
      matched.last_played = nextLastPlayed;
      matched.favorite = nextFav ? 1 : 0;
      matched.custom_name = nextCustomName;
      matched.genre = nextGenre;
      updatedGamesCount++;
    } else if (item.path || item.file) {
      const insertPath = String(item.path || item.file).trim();
      const rawName = String(item.originalName || item.name || path.basename(insertPath, path.extname(insertPath))).trim();
      const ext = String(item.extension || path.extname(insertPath) || ".exe").toLowerCase();
      const playTimeVal = resolvedSec !== null ? resolvedSec : 0;
      const playCountVal = resolvedCount !== null ? resolvedCount : playTimeVal > 0 ? 1 : 0;
      const favVal = resolvedFav ? 1 : 0;
      const genreVal =
        resolvedGenre ||
        detectGenreFromLocalRules({
          name: resolvedCustomName || rawName,
          originalName: rawName,
          resolvedExe: item.resolvedExe || item.resolved_exe || `${rawName}.exe`,
        }) ||
        null;

      try {
        const res = await dbRun(
          `INSERT INTO games (name, custom_name, path, extension, cover, resolved_exe, steam_id, play_time, play_count, favorite, last_played, genre)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rawName,
            resolvedCustomName || null,
            insertPath,
            ext,
            item.cover || null,
            item.resolvedExe || item.resolved_exe || `${rawName}.exe`,
            item.steamId || item.steam_id || null,
            playTimeVal,
            playCountVal,
            favVal,
            resolvedLast || null,
            genreVal,
          ]
        );
        if (item.id !== undefined) {
          oldIdToNewId.set(Number(item.id), res.lastID);
        }
        insertedGamesCount++;
      } catch {
        // Ignore duplicate path constraint error
      }
    }
  }

  dbGames = await dbAll("SELECT * FROM games");

  // Importar sessões (outros tempos / histórico de partidas)
  let importedSessionsCount = 0;
  if (Array.isArray(rawPayload.sessions)) {
    if (normalizedMode === "replace") {
      await dbRun("DELETE FROM sessions");
    }

    const existingSessions =
      normalizedMode === "merge"
        ? await dbAll("SELECT game_id, started_at, ended_at, duration FROM sessions")
        : [];
    const sessionSignatures = new Set(
      existingSessions.map((s) => `${s.started_at || ""}|${s.ended_at || ""}|${s.duration || 0}`)
    );

    for (const s of incomingSessions) {
      if (!s || typeof s !== "object") continue;
      const durationSec = resolveImportedDuration(
        s.duration,
        s.durationFormatted,
        undefined
      );
      if (durationSec === null && !s.startedAt && !s.started_at) continue;

      const startedAt = s.startedAt || s.started_at || null;
      const endedAt = s.endedAt || s.ended_at || null;
      const finalDuration = durationSec !== null ? durationSec : 0;

      const sig = `${startedAt || ""}|${endedAt || ""}|${finalDuration}`;
      if (normalizedMode === "merge" && sessionSignatures.has(sig)) {
        continue;
      }

      let targetGameId = null;
      const rawGameId = Number(s.gameId ?? s.game_id);
      if (oldIdToNewId.has(rawGameId)) {
        targetGameId = oldIdToNewId.get(rawGameId);
      } else {
        const matchedSessionGame = matchGameRecord(
          {
            path: s.gamePath,
            originalName: s.gameOriginalName,
            name: s.gameName,
          },
          dbGames
        );
        if (matchedSessionGame) {
          targetGameId = matchedSessionGame.id;
        } else if (Number.isInteger(rawGameId) && rawGameId > 0) {
          targetGameId = rawGameId;
        }
      }

      await dbRun(
        `INSERT INTO sessions (game_id, started_at, ended_at, duration) VALUES (?, ?, ?, ?)`,
        [targetGameId, startedAt, endedAt, finalDuration]
      );
      sessionSignatures.add(sig);
      importedSessionsCount++;
    }
  }

  // Importar conquistas (achievements) da nuvem ou JSON
  let importedAchievementsCount = 0;
  if (incomingAchievements.length > 0) {
    if (normalizedMode === "replace") {
      await dbRun("DELETE FROM achievements");
    }

    const nowIso = new Date().toISOString();
    for (const ach of incomingAchievements) {
      if (!ach || typeof ach !== "object") continue;
      const apiName = String(ach.apiName || ach.api_name || "").trim();
      if (!apiName) continue;

      let targetGameId = null;
      const rawGameId = Number(ach.gameId ?? ach.game_id);
      if (oldIdToNewId.has(rawGameId)) {
        targetGameId = oldIdToNewId.get(rawGameId);
      } else {
        const matchedAchGame = matchGameRecord(
          {
            path: ach.gamePath,
            steamId: ach.steamId || ach.steam_id,
            originalName: ach.gameOriginalName,
            name: ach.gameName,
          },
          dbGames
        );
        if (matchedAchGame) {
          targetGameId = matchedAchGame.id;
        }
      }

      if (!targetGameId) continue;

      const steamIdVal = String(ach.steamId || ach.steam_id || "0").trim();
      const nameVal = String(ach.name || apiName).trim();
      const descVal = String(ach.description || "").trim();
      const iconUrlVal = String(ach.iconUrl || ach.icon_url || "").trim();
      const iconGrayUrlVal = String(ach.iconGrayUrl || ach.icon_gray_url || iconUrlVal).trim();
      const hiddenVal = ach.hidden ? 1 : 0;
      const achievedVal = ach.achieved ? 1 : 0;
      const unlockTimeVal = Math.max(0, Math.round(Number(ach.unlockTime ?? ach.unlock_time) || 0));
      const updatedAtVal = ach.updatedAt || ach.updated_at || nowIso;

      try {
        await dbRun(
          `INSERT INTO achievements (
            game_id, steam_id, api_name, name, description,
            icon_url, icon_gray_url, hidden, achieved, unlock_time, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id, api_name) DO UPDATE SET
            steam_id = COALESCE(NULLIF(excluded.steam_id, '0'), achievements.steam_id),
            name = COALESCE(NULLIF(excluded.name, ''), achievements.name),
            description = CASE WHEN excluded.description != '' THEN excluded.description ELSE achievements.description END,
            icon_url = CASE WHEN excluded.icon_url != '' THEN excluded.icon_url ELSE achievements.icon_url END,
            icon_gray_url = CASE WHEN excluded.icon_gray_url != '' THEN excluded.icon_gray_url ELSE achievements.icon_gray_url END,
            hidden = excluded.hidden,
            achieved = MAX(achievements.achieved, excluded.achieved),
            unlock_time = CASE
              WHEN excluded.unlock_time > 0 AND (achievements.unlock_time = 0 OR excluded.unlock_time < achievements.unlock_time)
              THEN excluded.unlock_time
              ELSE achievements.unlock_time
            END,
            updated_at = excluded.updated_at`,
          [
            targetGameId,
            steamIdVal,
            apiName,
            nameVal,
            descVal,
            iconUrlVal,
            iconGrayUrlVal,
            hiddenVal,
            achievedVal,
            unlockTimeVal,
            updatedAtVal,
          ]
        );
        importedAchievementsCount++;
      } catch {
        // Ignora erro individual de FK/constraint
      }
    }
  }

  // Atualizar Tempo de Sofá (couchTimeSeconds / couchTimeOffsetSeconds)
  const totalDbPlayTime = dbGames.reduce((acc, g) => acc + (Number(g.play_time) || 0), 0);
  if (incomingSummary) {
    const prevOffsetRaw = await getMeta("couch_time_offset", "0");
    const prevOffset = parseInt(prevOffsetRaw, 10) || 0;
    const summaryGamesSec = Number(incomingSummary.gamesPlayTimeSeconds) || 0;
    const summaryOffsetSec =
      typeof incomingSummary.couchTimeOffsetSeconds === "number"
        ? Math.round(incomingSummary.couchTimeOffsetSeconds)
        : 0;

    const resolvedCouchSec = resolveImportedDuration(
      incomingSummary.couchTimeSeconds,
      incomingSummary.couchTimeFormatted,
      summaryGamesSec + summaryOffsetSec
    );

    if (
      resolvedCouchSec !== null &&
      resolvedCouchSec !== summaryGamesSec + summaryOffsetSec
    ) {
      // Usuário editou diretamente o couchTimeSeconds ou couchTimeFormatted no JSON
      const newOffset = resolvedCouchSec - totalDbPlayTime;
      await setMeta("couch_time_offset", String(newOffset));
    } else if (typeof incomingSummary.couchTimeOffsetSeconds === "number") {
      const nextOffset =
        normalizedMode === "replace"
          ? summaryOffsetSec
          : Math.max(prevOffset, summaryOffsetSec);
      await setMeta("couch_time_offset", String(nextOffset));
    } else if (
      resolvedCouchSec !== null &&
      incomingGames.length === 0
    ) {
      const newOffset = resolvedCouchSec - totalDbPlayTime;
      await setMeta("couch_time_offset", String(newOffset));
    }
  }

  // Sincroniza objetos em memória (games array)
  const dbById = new Map(dbGames.map((r) => [r.id, r]));
  for (const g of games) {
    const row = dbById.get(g.id);
    if (row) {
      g.playTime = Number(row.play_time) || 0;
      g.playCount = Number(row.play_count) || 0;
      g.lastPlayed = row.last_played || null;
      g.favorite = Boolean(row.favorite);
      g.customName = row.custom_name || "";
      g.name = row.custom_name || row.name;
      g.genre = row.genre || g.genre || null;
    }
  }

  games.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const savedPayload =
    options?.saveToJson !== false ? await savePlaytimeJson() : await buildPlaytimePayload();

  return {
    mode: normalizedMode,
    matchedGamesCount,
    updatedGamesCount,
    insertedGamesCount,
    importedSessionsCount,
    importedAchievementsCount,
    payload: savedPayload,
  };
}

// Na inicialização, verifica se playtime.json existe e foi editado externamente ou se o SQLite está vazio
async function syncFromLocalJsonOnStartup() {
  if (!fs.existsSync(PLAYTIME_JSON_PATH)) return;
  try {
    const rawContent = fs.readFileSync(PLAYTIME_JSON_PATH, "utf8");
    if (!rawContent.trim()) return;
    const parsed = JSON.parse(rawContent);
    const currentHash = crypto.createHash("sha256").update(rawContent).digest("hex");
    const lastHash = await getMeta("last_json_hash");
    const countRow = await dbGet("SELECT COUNT(*) AS cnt FROM games");
    const dbGamesCount = countRow?.cnt || 0;

    if (dbGamesCount === 0) {
      console.log("[JSON Sync] Banco SQLite vazio detectado. Restaurando tempos de playtime.json...");
      await importPlaytimeData(parsed, "merge", { saveToJson: false });
    } else if (lastHash && currentHash !== lastHash) {
      console.log("[JSON Sync] Alterações externas detectadas em playtime.json. Sincronizando tempos...");
      await importPlaytimeData(parsed, "replace", { saveToJson: false });
    } else if (!lastHash) {
      await importPlaytimeData(parsed, "merge", { saveToJson: false });
    }
  } catch (err) {
    console.error("Aviso ao ler playtime.json na inicialização:", err.message);
  }
}

// =========================
// CARREGA E SINCRONIZA JOGOS (PARALELO + SQLITE + JSON)
// =========================

async function loadGames() {
  await initDatabase();
  await loadAutomationSettings();
  if (typeof restartActiveGameMonitor === "function") {
    restartActiveGameMonitor();
  }
  await syncFromLocalJsonOnStartup();

  if (!GAME_FOLDER) {
    console.log("GAME_FOLDER não configurado no .env");
    await savePlaytimeJson();
    return;
  }

  if (!fs.existsSync(GAME_FOLDER)) {
    console.log("Pasta de jogos não encontrada:", GAME_FOLDER);
    await savePlaytimeJson();
    return;
  }

  const { signature: steamSignature, map: steamMap } = await getSteamPlaytimeMap(true);
  lastAppliedSteamSignature = steamSignature;

  const allFiles = scanFolder(GAME_FOLDER);
  const validFiles = allFiles.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return ext === ".exe" || ext === ".lnk" || ext === ".url";
  });

  // Processa todos os arquivos em paralelo para máxima velocidade
  const scannedItems = await Promise.all(
    validFiles.map(async (file) => {
      const ext = path.extname(file).toLowerCase();
      const rawName = path.basename(file, ext);

      let resolvedExe = null;
      let candidateExes = [];
      let steamId = null;

      if (ext === ".lnk") {
        const sc = await resolveShortcut(file);
        if (sc && sc.target) {
          candidateExes = discoverGameExecutables(sc.target, path.basename(sc.target));
          resolvedExe = candidateExes[0] || path.basename(sc.target);
          steamId = detectLocalSteamAppId(sc.target);
        } else {
          resolvedExe = rawName + ".exe";
          candidateExes = [resolvedExe];
        }
      } else if (ext === ".url") {
        try {
          const content = fs.readFileSync(file, "utf-8");
          const match = content.match(/steam:\/\/rungameid\/(\d+)/i);
          if (match) steamId = match[1];
        } catch {}
        resolvedExe = rawName + ".exe";
        candidateExes = [resolvedExe];
      } else {
        candidateExes = discoverGameExecutables(file, path.basename(file));
        resolvedExe = candidateExes[0] || path.basename(file);
        steamId = detectLocalSteamAppId(file);
      }

      // Verifica se já existe no banco SQLite (por path ou por nome caso a pasta tenha mudado)
      let dbRow = await dbGet("SELECT * FROM games WHERE path = ?", [file]);
      if (!dbRow) {
        const byName = await dbGet("SELECT * FROM games WHERE LOWER(name) = LOWER(?)", [rawName]);
        if (byName && (!byName.path || !fs.existsSync(byName.path))) {
          await dbRun("UPDATE games SET path = ? WHERE id = ?", [file, byName.id]);
          dbRow = { ...byName, path: file };
        }
      }

      const searchTitle = dbRow?.custom_name || rawName;
      let cover = dbRow?.cover;

      // Verifica se o arquivo da capa existe no disco; se não, baixa
      if (!cover || !fs.existsSync(path.join(COVER_FOLDER, cover))) {
        cover = await downloadCover(searchTitle);
      }

      const finalSteamId = dbRow?.steam_id || steamId;
      let genre = dbRow?.genre || null;
      if (!genre) {
        genre = await detectGameGenre({
          name: searchTitle,
          originalName: rawName,
          resolvedExe,
          steamId: finalSteamId,
        });
      }

      if (!dbRow) {
        const insertRes = await dbRun(
          `INSERT INTO games (name, custom_name, path, extension, cover, resolved_exe, steam_id, play_time, play_count, favorite, last_played, genre)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, ?)`,
          [rawName, null, file, ext, cover, resolvedExe, finalSteamId, genre]
        );
        dbRow = await dbGet("SELECT * FROM games WHERE id = ?", [insertRes.lastID]);
      } else {
        await dbRun(
          `UPDATE games SET name = ?, extension = ?, cover = ?, resolved_exe = ?, steam_id = ?, genre = ? WHERE id = ?`,
          [rawName, ext, cover, resolvedExe, finalSteamId, genre, dbRow.id]
        );
        dbRow.name = rawName;
        dbRow.extension = ext;
        dbRow.cover = cover;
        dbRow.resolved_exe = resolvedExe;
        dbRow.steam_id = finalSteamId;
        dbRow.genre = genre;
      }

      // Integra tempo de jogo e última sessão da Steam caso o jogo tenha steam_id
      if (steamId && steamMap.has(String(steamId))) {
        const st = steamMap.get(String(steamId));
        const steamSec = (st.playtimeMinutes || 0) * 60;
        const steamLastIso =
          st.lastPlayedUnix > 0 ? new Date(st.lastPlayedUnix * 1000).toISOString() : null;

        const curSec = Number(dbRow.play_time) || 0;
        const nextSec = Math.max(curSec, steamSec);

        const curLastMs = dbRow.last_played ? new Date(dbRow.last_played).getTime() : 0;
        const steamLastMs = steamLastIso ? new Date(steamLastIso).getTime() : 0;
        const nextLast = steamLastMs > curLastMs ? steamLastIso : dbRow.last_played || null;
        const nextCount = nextSec > 0 ? Math.max(1, dbRow.play_count || 0) : dbRow.play_count || 0;

        if (nextSec !== curSec || nextLast !== dbRow.last_played || nextCount !== dbRow.play_count) {
          await dbRun(
            `UPDATE games SET play_time = ?, play_count = ?, last_played = ? WHERE id = ?`,
            [nextSec, nextCount, nextLast, dbRow.id]
          );
          dbRow.play_time = nextSec;
          dbRow.play_count = nextCount;
          dbRow.last_played = nextLast;
        }
      }

      return {
        id: dbRow.id,
        name: dbRow.custom_name || dbRow.name,
        originalName: dbRow.name,
        customName: dbRow.custom_name || "",
        genre: dbRow.genre || genre || null,
        file: dbRow.path,
        extension: dbRow.extension,
        cover: dbRow.cover,
        resolvedExe: dbRow.resolved_exe,
        candidateExes: candidateExes.length > 0 ? candidateExes : [dbRow.resolved_exe].filter(Boolean),
        steamId: dbRow.steam_id,
        playTime: dbRow.play_time || 0,
        playCount: dbRow.play_count || 0,
        favorite: Boolean(dbRow.favorite),
        lastPlayed: dbRow.last_played || null,
      };
    })
  );

  // Ordena: Favoritos primeiro, depois ordem alfabética
  scannedItems.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  games = scannedItems;
  await savePlaytimeJson();
  console.log(`${games.length} jogos sincronizados com SQLite e playtime.json (incluindo dados da Steam).`);
}

// Encerra sessão ativa e grava tempo jogado no SQLite + playtime.json
async function finishActiveGameSession(targetId = null) {
  const target = targetId
    ? activeGames.get(targetId) || (activeGame && activeGame.id === targetId ? activeGame : null)
    : (activeGame || activeGames.values().next().value);

  if (!target) return null;
  const closed = { ...target };
  activeGames.delete(closed.id);
  if (activeGame && activeGame.id === closed.id) {
    activeGame = activeGames.values().next().value || null;
  }

  try {
    const startedMs = new Date(closed.startedAt).getTime();
    const endedAt = new Date().toISOString();
    const durationSec = Math.max(1, Math.floor((Date.now() - startedMs) / 1000));

    await dbRun(
      `INSERT INTO sessions (game_id, started_at, ended_at, duration) VALUES (?, ?, ?, ?)`,
      [closed.id, closed.startedAt, endedAt, durationSec]
    );

    const g = games.find((item) => item.id === closed.id);
    const basePlayTime =
      typeof closed.initialPlayTime === "number"
        ? closed.initialPlayTime
        : Number(g?.playTime) || 0;
    let newPlayTime = basePlayTime + durationSec;

    if (closed.steamId) {
      const { map: steamMap } = await getSteamPlaytimeMap(true);
      const st = steamMap.get(String(closed.steamId));
      if (st && st.playtimeMinutes > 0) {
        newPlayTime = Math.max(newPlayTime, st.playtimeMinutes * 60);
      }
    }

    await dbRun(`UPDATE games SET play_time = ?, last_played = ? WHERE id = ?`, [
      newPlayTime,
      endedAt,
      closed.id,
    ]);

    if (g) {
      g.playTime = newPlayTime;
      g.lastPlayed = endedAt;
    }

    await savePlaytimeJson();

    console.log(`[Sessão] ${closed.name} finalizado. Duração: ${durationSec}s (Total: ${newPlayTime}s)`);
  } catch (err) {
    console.error("Erro salvando sessão:", err.message);
  }

  ignoreDetectionFor(closed);
  wsManager.broadcastActiveGames({ closedGame: closed });

  return closed;
}

// =========================
// DETECÇÃO AUTOMÁTICA DE JOGOS ABERTOS FORA DO LAUNCHER
// =========================

const ACTIVE_GAME_MONITOR_INTERVAL_MS = 4000;
const PROCESS_LIST_CACHE_MS = 2500;
const IGNORE_AFTER_CLOSE_MS = 20000;

// Executáveis genéricos e clientes/launchers de loja: ficam abertos sem nenhum jogo rodando
// (ex.: Riot Client na tela de login), então nunca contam como "um jogo em execução"
const GENERIC_EXECUTABLES = new Set([
  "explorer.exe",
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "conhost.exe",
  "wscript.exe",
  "cscript.exe",
  "rundll32.exe",
  "svchost.exe",
  "javaw.exe",
  "java.exe",
  "steam.exe",
  "steamwebhelper.exe",
  "epicgameslauncher.exe",
  "riotclientservices.exe",
  "riotclientux.exe",
  "battle.net.exe",
  "eadesktop.exe",
  "origin.exe",
  "upc.exe",
  "ubisoftconnect.exe",
  "galaxyclient.exe",
]);

// Jogos fechados/ocultados que não devem voltar ao banner enquanto o mesmo processo estiver aberto
// gameId -> { until: timestamp, tokens: Set<string> | null }  (tokens null = ignora até o jogo fechar)
const ignoredDetections = new Map();

function ignoreDetectionFor(session) {
  const tokens = new Set();
  if (session.steamId && session.extension === ".url") tokens.add(`steam:${session.steamId}`);
  if (session.pid) tokens.add(`pid:${session.pid}`);

  ignoredDetections.set(session.id, {
    until: Date.now() + IGNORE_AFTER_CLOSE_MS,
    tokens: tokens.size > 0 ? tokens : null,
  });
}

let processListCache = { at: 0, map: null };

// Lista todos os processos do Windows de uma só vez: nome do executável (minúsculo) -> PID
function listRunningProcesses() {
  if (processListCache.map && Date.now() - processListCache.at < PROCESS_LIST_CACHE_MS) {
    return Promise.resolve(processListCache.map);
  }

  return new Promise((resolve) => {
    exec(
      "tasklist /FO CSV /NH",
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);

        const map = new Map();
        for (const line of stdout.split(/\r?\n/)) {
          const match = line.match(/^"([^"]*)","(\d+)"/);
          if (!match) continue;
          const name = match[1].toLowerCase();
          if (!map.has(name)) map.set(name, parseInt(match[2], 10));
        }

        processListCache = { at: Date.now(), map };
        resolve(map);
      }
    );
  });
}

// AppID do jogo Steam em execução (a Steam grava em tempo real no Registro do usuário)
function getSteamRunningAppId() {
  return new Promise((resolve) => {
    exec(
      'reg query "HKCU\\Software\\Valve\\Steam" /v RunningAppID',
      { encoding: "utf8", windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const match = stdout.match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i);
        if (!match) return resolve(null);
        const appId = parseInt(match[1], 16);
        resolve(appId > 0 ? String(appId) : null);
      }
    );
  });
}

// Horário real em que o processo foi iniciado (para o cronômetro refletir o tempo já jogado)
function getProcessStartTime(pid) {
  return new Promise((resolve) => {
    if (!Number.isInteger(pid) || pid <= 0) return resolve(null);
    exec(
      `powershell -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')"`,
      { encoding: "utf8", timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const startedMs = new Date(stdout.trim()).getTime();
        if (!Number.isFinite(startedMs) || startedMs > Date.now()) return resolve(null);
        resolve(new Date(startedMs).toISOString());
      }
    );
  });
}

// Procura o primeiro executável em execução dentre uma lista de candidatos do jogo
async function findAnyProcessPid(exeCandidates) {
  const list = Array.isArray(exeCandidates)
    ? exeCandidates.filter(Boolean)
    : [exeCandidates].filter(Boolean);
  if (list.length === 0) return null;

  const processes = await listRunningProcesses();
  if (processes) {
    for (const exe of list) {
      const pid = processes.get(exe.toLowerCase());
      if (pid) return { pid, exeName: exe };
    }
  }

  for (const exe of list) {
    const pid = await findProcessPid(exe);
    if (pid) return { pid, exeName: exe };
  }

  return null;
}

// Índice executável -> jogo. Descarta executáveis genéricos e os compartilhados por mais de
// um jogo (ex.: um mesmo launcher em vários atalhos), pois não dá para saber qual deles está aberto.
function buildExecutableIndex() {
  const byExe = new Map();

  for (const game of games) {
    if (game.extension === ".url") continue;
    const candidates =
      Array.isArray(game.candidateExes) && game.candidateExes.length > 0
        ? game.candidateExes
        : [game.resolvedExe].filter(Boolean);

    for (const rawExe of candidates) {
      const exe = (rawExe || "").toLowerCase();
      if (!exe.endsWith(".exe") || GENERIC_EXECUTABLES.has(exe)) continue;
      if (!byExe.has(exe)) byExe.set(exe, []);
      const list = byExe.get(exe);
      if (!list.includes(game)) list.push(game);
    }
  }

  for (const [exe, list] of byExe) {
    if (list.length !== 1) byExe.delete(exe);
  }

  return byExe;
}

// Procura todos os jogos da biblioteca que estejam rodando no PC sem ter sido iniciados pelo launcher
async function detectExternalGames() {
  if (games.length === 0) return [];

  const [steamAppId, processes] = await Promise.all([
    getSteamRunningAppId(),
    listRunningProcesses(),
  ]);
  if (!processes) return []; // falha ao listar processos: não altera nada

  const candidates = [];
  const seenGameIds = new Set();

  if (steamAppId) {
    const steamGame = games.find((g) => g.extension === ".url" && g.steamId === steamAppId);
    if (steamGame) {
      seenGameIds.add(steamGame.id);
      candidates.push({ game: steamGame, via: "steam", pid: null, exeName: steamGame.resolvedExe, token: `steam:${steamAppId}` });
    }
  }

  for (const [exe, [game]] of buildExecutableIndex()) {
    if (seenGameIds.has(game.id)) continue;
    const pid = processes.get(exe);
    if (pid) {
      seenGameIds.add(game.id);
      const matchedExe =
        (game.candidateExes || []).find((c) => c.toLowerCase() === exe) || game.resolvedExe;
      candidates.push({ game, via: "exe", pid, exeName: matchedExe, token: `pid:${pid}` });
    }
  }

  // Limpa ignorados cujo processo já fechou
  const now = Date.now();
  for (const [gameId, entry] of ignoredDetections) {
    const running = candidates.filter((c) => c.game.id === gameId);
    if (running.length === 0) {
      if (entry.until <= now) ignoredDetections.delete(gameId);
      continue;
    }
    if (entry.tokens) {
      const live = new Set(running.map((c) => c.token));
      for (const token of entry.tokens) {
        if (!live.has(token)) entry.tokens.delete(token);
      }
      if (entry.tokens.size === 0 && entry.until <= now) ignoredDetections.delete(gameId);
    }
  }

  const valid = [];
  for (const candidate of candidates) {
    const ignored = ignoredDetections.get(candidate.game.id);
    if (ignored && (ignored.until > now || ignored.tokens === null || ignored.tokens.has(candidate.token))) {
      continue;
    }
    valid.push(candidate);
  }

  return valid;
}

const detectExternalGame = async () => (await detectExternalGames())[0] || null;

// Passa a monitorar um jogo encontrado em execução
async function adoptDetectedGame({ game, via, pid, exeName }) {
  if (activeGames.has(game.id)) return;

  const startedAt = (pid && (await getProcessStartTime(pid))) || new Date().toISOString();
  if (activeGames.has(game.id)) return;

  const activeExe = exeName || game.resolvedExe;
  const newActive = {
    id: game.id,
    name: game.name,
    file: game.file,
    extension: game.extension,
    cover: game.cover,
    pid: pid || null,
    exeName: activeExe,
    candidateExes: game.candidateExes || [activeExe].filter(Boolean),
    steamId: game.steamId,
    startedAt,
    initialPlayTime: game.playTime || 0,
    seenRunning: true,
    source: "auto",
    detectedBy: via,
  };

  activeGames.set(game.id, newActive);
  if (!activeGame) activeGame = newActive;

  try {
    const nowIso = new Date().toISOString();
    await dbRun(
      `UPDATE games SET play_count = COALESCE(play_count, 0) + 1, last_played = ? WHERE id = ?`,
      [nowIso, game.id]
    );
    game.playCount = (game.playCount || 0) + 1;
    game.lastPlayed = nowIso;
    await savePlaytimeJson();
  } catch (err) {
    console.error("Erro atualizando jogo detectado:", err.message);
  }

  console.log(
    `[Auto-Detect] Jogo detectado fora do launcher: ${game.name} ` +
      `(${via === "steam" ? `Steam AppID ${game.steamId}` : `${activeExe}, PID ${pid}`})`
  );
  wsManager.broadcastActiveGames({ startedGame: newActive });
}

// Inicializa biblioteca
loadGames();

// =========================
// ROTAS DE BIBLIOTECA
// =========================

app.use("/covers", express.static(COVER_FOLDER));

// Status
app.get("/", (req, res) => {
  res.json({
    status: "online",
    games: games.length,
    serverIp: SERVER_IP,
    port: PORT,
    frontendPort: FRONTEND_PORT,
  });
});

// Lista jogos
app.get("/games", async (req, res) => {
  await syncSteamPlaytimesInMemory();

  const achRows = await dbAll(
    "SELECT game_id, COUNT(*) AS total, SUM(CASE WHEN achieved = 1 THEN 1 ELSE 0 END) AS unlocked FROM achievements GROUP BY game_id"
  ).catch(() => []);
  const achMap = new Map(
    achRows.map((r) => [r.game_id, { total: r.total || 0, unlocked: r.unlocked || 0 }])
  );

  res.json(
    games.map((game) => {
      const ach = achMap.get(game.id) || { total: 0, unlocked: 0 };
      const genre =
        game.genre ||
        detectGenreFromLocalRules({
          name: game.name,
          originalName: game.originalName,
          resolvedExe: game.resolvedExe,
        }) ||
        null;
      return {
        id: game.id,
        name: game.name,
        originalName: game.originalName,
        customName: game.customName,
        genre,
        cover: game.cover,
        extension: game.extension,
        resolvedExe: game.resolvedExe,
        steamId: game.steamId || null,
        playTime: game.playTime,
        playCount: game.playCount,
        favorite: game.favorite,
        lastPlayed: game.lastPlayed,
        achievementsTotal: ach.total,
        achievementsUnlocked: ach.unlocked,
      };
    })
  );
});

// Resumo de tempos (tempo de jogos, tempo de sofá, sessões e arquivo JSON)
app.get("/times", async (req, res) => {
  try {
    await syncSteamPlaytimesInMemory();
    const payload = await buildPlaytimePayload();
    res.json({
      success: true,
      jsonFile: "backend/playtime.json",
      updatedAt: payload.updatedAt,
      summary: payload.summary,
      recentSessions: payload.sessions.slice(-30).reverse(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Exportar JSON completo com tempo de jogos, tempo de sofá e histórico de sessões
app.get("/times/export", async (req, res) => {
  try {
    await syncSteamPlaytimesInMemory();
    const payload = await savePlaytimeJson();
    if (!payload) {
      return res.status(500).json({
        success: false,
        message: "Não foi possível gerar o arquivo JSON de tempos.",
      });
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `gamelauncher-tempos-${dateStamp}.json`;

    if (req.query.download === "1" || req.query.download === "true") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(JSON.stringify(payload, null, 2));
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Importar JSON de tempos (mesclar ou substituir)
app.post("/times/import", async (req, res) => {
  try {
    const body = req.body || {};
    const mode = body.mode || req.query.mode || "merge";
    const rawData =
      body.data && typeof body.data === "object" ? body.data : body;

    const result = await importPlaytimeData(rawData, mode, { saveToJson: true });
    res.json({
      success: true,
      mode: result.mode,
      stats: {
        matchedGames: result.matchedGamesCount,
        updatedGames: result.updatedGamesCount,
        insertedGames: result.insertedGamesCount,
        importedSessions: result.importedSessionsCount,
      },
      summary: result.payload?.summary || null,
      recentSessions: result.payload?.sessions ? result.payload.sessions.slice(-30).reverse() : [],
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || "Falha ao importar JSON de tempos.",
    });
  }
});

// Recarregar tempos diretamente do arquivo local backend/playtime.json
app.post("/times/reload-local", async (req, res) => {
  try {
    if (!fs.existsSync(PLAYTIME_JSON_PATH)) {
      const created = await savePlaytimeJson();
      return res.json({
        success: true,
        mode: "merge",
        stats: {
          matchedGames: games.length,
          updatedGames: 0,
          insertedGames: 0,
          importedSessions: 0,
        },
        summary: created?.summary || null,
        recentSessions: created?.sessions ? created.sessions.slice(-30).reverse() : [],
      });
    }

    const rawContent = fs.readFileSync(PLAYTIME_JSON_PATH, "utf8");
    const parsed = JSON.parse(rawContent);
    const mode = req.body?.mode || "replace";
    const result = await importPlaytimeData(parsed, mode, { saveToJson: true });

    res.json({
      success: true,
      mode: result.mode,
      stats: {
        matchedGames: result.matchedGamesCount,
        updatedGames: result.updatedGamesCount,
        insertedGames: result.insertedGamesCount,
        importedSessions: result.importedSessionsCount,
      },
      summary: result.payload?.summary || null,
      recentSessions: result.payload?.sessions ? result.payload.sessions.slice(-30).reverse() : [],
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Erro ao ler backend/playtime.json: " + error.message,
    });
  }
});

// =========================
// CONFIGURAÇÕES DA AUTOMAÇÃO E SISTEMA (.env + SQLite app_meta)
// =========================

app.get("/settings", async (req, res) => {
  try {
    await loadAutomationSettings();
    const folderCheck = inspectGameFolder(GAME_FOLDER);
    const networkInterfaces = getLocalNetworkAddresses();
    const steamGridDbKey = (process.env.STEAMGRIDDB_KEY || "").trim();
    const steamApiKey = (process.env.STEAM_API_KEY || "").trim();
    const steamUserId = (process.env.STEAM_USER_ID || "").trim();
    const detectedSteam = detectLocalSteamUser();
    const supabaseKey = (process.env.SUPABASE_KEY || "").trim();
    const supabasePassword = (process.env.SUPABASE_PASSWORD || "").trim();

    res.json({
      success: true,
      env: {
        serverIp: SERVER_IP || "127.0.0.1",
        port: Number(PORT) || 3060,
        frontendPort: Number(FRONTEND_PORT) || 8060,
        apiUrl: `http://${SERVER_IP || "127.0.0.1"}:${PORT || 3060}`,
        frontendUrl: `http://${SERVER_IP || "127.0.0.1"}:${FRONTEND_PORT || 8060}`,
        gameFolder: GAME_FOLDER || "",
        hasSteamGridDbKey: Boolean(steamGridDbKey),
        steamGridDbKey: steamGridDbKey,
        steamGridDbKeyHint: maskSecretHint(steamGridDbKey),
        hasSteamApiKey: Boolean(steamApiKey),
        steamApiKey: steamApiKey,
        steamApiKeyHint: maskSecretHint(steamApiKey),
        steamUserId: steamUserId || detectedSteam.steamId64 || "",
        supabaseUrl: process.env.SUPABASE_URL || "",
        hasSupabaseKey: Boolean(supabaseKey),
        supabaseKey: supabaseKey,
        supabaseKeyHint: maskSecretHint(supabaseKey),
        supabaseEmail: (process.env.SUPABASE_EMAIL || "").trim(),
        hasSupabasePassword: Boolean(supabasePassword),
        supabasePassword: supabasePassword,
        hasApiToken: Boolean(API_TOKEN),
        apiToken: API_TOKEN,
        apiTokenHint: maskSecretHint(API_TOKEN),
      },
      steam: {
        hasApiKey: Boolean(steamApiKey),
        apiKeyHint: maskSecretHint(steamApiKey),
        steamUserId: steamUserId || detectedSteam.steamId64 || "",
        detected: detectedSteam,
      },
      supabase: {
        url: process.env.SUPABASE_URL || "",
        hasKey: Boolean(supabaseKey),
        email: (process.env.SUPABASE_EMAIL || "").trim(),
        hasPassword: Boolean(supabasePassword),
        status: typeof supabaseSync?.getSyncStatus === "function" ? supabaseSync.getSyncStatus() : null,
      },
      automation: {
        ...automationSettings,
      },
      folderStatus: folderCheck,
      networkInterfaces,
      files: {
        rootEnv: ".env",
        backendEnv: "backend/.env",
        frontendEnv: "frontend/.env",
        playtimeJson: "backend/playtime.json",
        sqliteDb: "backend/database.sqlite",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao carregar configurações: " + error.message,
    });
  }
});

app.post("/settings/validate-folder", async (req, res) => {
  try {
    const candidate = req.body?.gameFolder ?? GAME_FOLDER;
    const result = inspectGameFolder(candidate);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/settings/test-steamgriddb", async (req, res) => {
  try {
    const rawCandidate =
      typeof req.body?.steamGridDbKey === "string" ? req.body.steamGridDbKey.trim() : "";
    const candidateKey = rawCandidate || process.env.STEAMGRIDDB_KEY || "";
    const result = await testSteamGridDbKey(candidateKey);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      valid: false,
      message: error.message,
    });
  }
});

app.post("/settings/detect-steam", (req, res) => {
  try {
    const detected = detectLocalSteamUser();
    res.json({
      success: true,
      ...detected,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro detectando usuário da Steam: " + error.message,
    });
  }
});

app.post("/settings/test-steam", async (req, res) => {
  try {
    const rawCandidate =
      typeof req.body?.steamApiKey === "string" ? req.body.steamApiKey.trim() : "";
    const candidateKey = rawCandidate || process.env.STEAM_API_KEY || "";

    const rawId = typeof req.body?.steamUserId === "string" ? req.body.steamUserId.trim() : "";
    const candidateId = rawId || process.env.STEAM_USER_ID || detectLocalSteamUser().steamId64;

    const result = await testSteamApiKey(candidateKey, candidateId);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      valid: false,
      message: error.message,
    });
  }
});

// =========================
// SINCRONIZAÇÃO EM NUVEM (SUPABASE)
// =========================

app.get("/supabase/status", async (req, res) => {
  try {
    const conn = await supabaseSync.testConnection();
    const status = supabaseSync.getSyncStatus();
    res.json({
      success: true,
      configured: conn.configured,
      connected: conn.connected,
      authenticated: Boolean(conn.authenticated),
      authMode: conn.authMode || status.authMode,
      needTables: Boolean(conn.needTables),
      needAuth: Boolean(conn.needAuth),
      error: conn.error,
      status,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/supabase/push", async (req, res) => {
  try {
    const payload = await buildPlaytimePayload();
    const result = await supabaseSync.pushPlaytimeToSupabase(payload);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error || result.reason });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/supabase/pull", async (req, res) => {
  try {
    const pullResult = await supabaseSync.pullPlaytimeFromSupabase();
    if (!pullResult.success) {
      return res.status(400).json({ success: false, message: pullResult.error || pullResult.reason });
    }

    const mode = req.body?.mode || "merge";
    const imported = await importPlaytimeData(
      {
        games: pullResult.games,
        sessions: pullResult.sessions,
        achievements: pullResult.achievements,
        summary: pullResult.summary,
      },
      mode,
      { saveToJson: true }
    );

    res.json({
      success: true,
      stats: {
        matchedGames: imported.matchedGamesCount,
        updatedGames: imported.updatedGamesCount,
        insertedGames: imported.insertedGamesCount,
        importedSessions: imported.importedSessionsCount,
        importedAchievements: imported.importedAchievementsCount,
      },
      syncedAt: pullResult.syncedAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put("/settings", async (req, res) => {
  try {
    const body = req.body || {};
    const envInput = body.env && typeof body.env === "object" ? body.env : body;
    const autoInput =
      body.automation && typeof body.automation === "object" ? body.automation : body;

    const prevIp = SERVER_IP;
    const prevPort = String(PORT);
    const prevFrontendPort = String(FRONTEND_PORT);
    const prevFolder = GAME_FOLDER;
    const prevKey = (process.env.STEAMGRIDDB_KEY || "").trim();

    const savedEnv = persistEnvFiles({
      serverIp: envInput.serverIp !== undefined ? envInput.serverIp : SERVER_IP,
      port: envInput.port !== undefined ? envInput.port : PORT,
      frontendPort:
        envInput.frontendPort !== undefined ? envInput.frontendPort : FRONTEND_PORT,
      gameFolder: envInput.gameFolder !== undefined ? envInput.gameFolder : GAME_FOLDER,
      steamGridDbKey: envInput.steamGridDbKey,
      steamApiKey: envInput.steamApiKey,
      steamUserId: envInput.steamUserId,
      supabaseUrl:
        envInput.supabaseUrl !== undefined
          ? envInput.supabaseUrl
          : process.env.SUPABASE_URL || "",
      supabaseKey: envInput.supabaseKey,
      supabaseEmail:
        envInput.supabaseEmail !== undefined
          ? envInput.supabaseEmail
          : process.env.SUPABASE_EMAIL || "",
      supabasePassword: envInput.supabasePassword,
      apiToken: envInput.apiToken,
    });

    const newKeyVal = savedEnv._internalKeyChanged || "";
    delete savedEnv._internalKeyChanged;

    const savedAutomation = await saveAutomationSettings(autoInput);

    const folderChanged = savedEnv.gameFolder !== prevFolder;
    const keyChanged = newKeyVal !== prevKey;
    const networkChanged =
      savedEnv.serverIp !== prevIp ||
      String(savedEnv.port) !== prevPort ||
      String(savedEnv.frontendPort) !== prevFrontendPort;

    if (folderChanged || (keyChanged && newKeyVal)) {
      await loadGames();
    }

    const folderStatus = inspectGameFolder(GAME_FOLDER);

    res.json({
      success: true,
      message: networkChanged
        ? "Configurações salvas! Como IP/Porta foram alterados, reinicie o GameLauncher se mudar de endereço."
        : "Configurações da automação e variáveis salvas e aplicadas em tempo real!",
      requiresRestart: networkChanged,
      reloadedLibrary: folderChanged || (keyChanged && Boolean(newKeyVal)),
      totalGames: games.length,
      env: {
        ...savedEnv,
        frontendUrl: `http://${savedEnv.serverIp}:${savedEnv.frontendPort}`,
      },
      automation: savedAutomation,
      folderStatus,
      networkInterfaces: getLocalNetworkAddresses(),
    });
  } catch (error) {
    console.error("Erro ao salvar configurações:", error);
    res.status(500).json({
      success: false,
      message: "Falha ao salvar configurações: " + error.message,
    });
  }
});

// Atualizar biblioteca
app.post("/refresh", async (req, res) => {
  await loadGames();
  res.json({
    success: true,
    total: games.length,
  });
});

// Alternar Favorito
app.post("/games/:id/favorite", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const game = games.find((g) => g.id === id);
  if (!game) {
    return res.status(404).json({ success: false, message: "Jogo não encontrado" });
  }

  game.favorite = !game.favorite;
  await dbRun(`UPDATE games SET favorite = ? WHERE id = ?`, [game.favorite ? 1 : 0, id]);

  games.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  await savePlaytimeJson();

  res.json({
    success: true,
    id: game.id,
    favorite: game.favorite,
  });
});

// Buscar opções de capas no SteamGridDB para um jogo
app.get("/games/:id/covers", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const game = games.find((g) => g.id === id);
  if (!game) {
    return res.status(404).json({ success: false, message: "Jogo não encontrado" });
  }

  const query = (req.query.query || game.name || game.originalName).trim();
  const covers = await searchGameCovers(query);
  res.json({
    success: true,
    query,
    covers,
  });
});

// Editar nome de exibição, tempo de jogo, AppID da Steam e/ou trocar capa do jogo
app.put("/games/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const game = games.find((g) => g.id === id);
  if (!game) {
    return res.status(404).json({ success: false, message: "Jogo não encontrado" });
  }

  const { customName, coverUrl, playTime, steamId, genre } = req.body || {};

  try {
    if (typeof customName === "string") {
      const trimmed = customName.trim();
      game.customName = trimmed;
      game.name = trimmed || game.originalName;
      await dbRun(`UPDATE games SET custom_name = ? WHERE id = ?`, [trimmed || null, id]);
    }

    if (steamId !== undefined) {
      const cleanedSteamId = steamId ? String(steamId).trim().replace(/\D/g, "") : null;
      game.steamId = cleanedSteamId || null;
      await dbRun(`UPDATE games SET steam_id = ? WHERE id = ?`, [game.steamId, id]);

      // Se configurou um steam_id e temos chave de API, dispara sincronização em background
      if (game.steamId && process.env.STEAM_API_KEY) {
        syncGameAchievements(
          game.id,
          game.steamId,
          process.env.STEAM_API_KEY,
          process.env.STEAM_USER_ID,
          game.resolvedExe || game.file
        ).catch(() => {});
      }
    }

    if (genre !== undefined) {
      const rawGenre = genre === null ? "" : String(genre).trim();
      if (rawGenre.toLowerCase() === "auto") {
        game.genre = await detectGameGenre({
          name: game.name,
          originalName: game.originalName,
          resolvedExe: game.resolvedExe,
          steamId: game.steamId,
        });
      } else {
        game.genre = rawGenre || null;
      }
      await dbRun(`UPDATE games SET genre = ? WHERE id = ?`, [game.genre, id]);
    }

    if (playTime !== undefined && playTime !== null && playTime !== "") {
      const parsedSec = parseHumanDuration(playTime);
      if (parsedSec !== null) {
        game.playTime = parsedSec;
        if (parsedSec > 0 && (!game.playCount || game.playCount <= 0)) {
          game.playCount = 1;
        }
        await dbRun(`UPDATE games SET play_time = ?, play_count = ? WHERE id = ?`, [
          game.playTime,
          game.playCount || 0,
          id,
        ]);
      }
    }

    if (coverUrl && typeof coverUrl === "string") {
      const newCoverFile = await downloadCover(game.name, coverUrl.trim(), true);
      if (newCoverFile) {
        game.cover = newCoverFile;
        await dbRun(`UPDATE games SET cover = ? WHERE id = ?`, [newCoverFile, id]);
      }
    }

    games.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    await savePlaytimeJson();

    res.json({
      success: true,
      game,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =========================
// CONQUISTAS (STEAM & JOGOS LOCAIS / EMULADORES)
// =========================

// Retorna conquistas de um jogo (busca do SQLite e auto-sincroniza se vazio e com chave)
app.get("/games/:id/achievements", async (req, res) => {
  try {
    const gameId = parseInt(req.params.id, 10);
    const game = games.find((g) => g.id === gameId);
    if (!game) {
      return res.status(404).json({ success: false, message: "Jogo não encontrado" });
    }

    let targetExePath = game.file;
    if (game.extension === ".lnk") {
      const sc = await resolveShortcut(game.file);
      if (sc && sc.target) targetExePath = sc.target;
    }

    // Auto-detecta Steam AppID local se não configurado
    let effectiveSteamId = game.steamId;
    if (!effectiveSteamId) {
      effectiveSteamId = detectLocalSteamAppId(targetExePath);
      if (effectiveSteamId) {
        game.steamId = effectiveSteamId;
        await dbRun(`UPDATE games SET steam_id = ? WHERE id = ?`, [effectiveSteamId, game.id]);
      }
    }

    let data = await getGameAchievementsFromDb(gameId);

    const steamKey = (process.env.STEAM_API_KEY || "").trim();
    if (data.total === 0 && effectiveSteamId && steamKey) {
      try {
        const steamId64 =
          (process.env.STEAM_USER_ID || "").trim() || detectLocalSteamUser().steamId64;
        data = await syncGameAchievements(
          gameId,
          effectiveSteamId,
          steamKey,
          steamId64,
          targetExePath
        );
        savePlaytimeJson().catch(() => {});
      } catch (syncErr) {
        console.warn(`[Achievements] Auto-sync para jogo ${game.name} falhou:`, syncErr.message);
      }
    }

    res.json({
      success: true,
      gameId: game.id,
      gameName: game.name,
      steamId: effectiveSteamId || null,
      hasApiKey: Boolean(process.env.STEAM_API_KEY),
      ...data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Sincroniza forçadamente as conquistas de um jogo (Steam oficial e emuladores locais)
app.post("/games/:id/sync-achievements", async (req, res) => {
  try {
    const gameId = parseInt(req.params.id, 10);
    const game = games.find((g) => g.id === gameId);
    if (!game) {
      return res.status(404).json({ success: false, message: "Jogo não encontrado" });
    }

    let targetExePath = game.file;
    if (game.extension === ".lnk") {
      const sc = await resolveShortcut(game.file);
      if (sc && sc.target) targetExePath = sc.target;
    }

    // Auto-detecta Steam AppID local se não configurado
    let effectiveSteamId = game.steamId;
    if (!effectiveSteamId) {
      effectiveSteamId = detectLocalSteamAppId(targetExePath);
      if (effectiveSteamId) {
        game.steamId = effectiveSteamId;
        await dbRun(`UPDATE games SET steam_id = ? WHERE id = ?`, [effectiveSteamId, game.id]);
      }
    }

    if (!effectiveSteamId) {
      return res.status(400).json({
        success: false,
        message: "Este jogo não possui Steam AppID associado. Informe o AppID na edição do jogo.",
      });
    }

    const steamKey = (process.env.STEAM_API_KEY || "").trim();
    if (!steamKey) {
      return res.status(400).json({
        success: false,
        message: "Chave da API Steam não configurada. Adicione-a na página de Configurações.",
      });
    }

    const steamId64 =
      (process.env.STEAM_USER_ID || "").trim() || detectLocalSteamUser().steamId64;
    const result = await syncGameAchievements(
      gameId,
      effectiveSteamId,
      steamKey,
      steamId64,
      targetExePath
    );

    savePlaytimeJson().catch(() => {});

    res.json({
      success: true,
      gameId: game.id,
      gameName: game.name,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Sincroniza conquistas de todos os jogos da biblioteca que tenham steamId ou detecção local
app.post("/steam/sync-all-achievements", async (req, res) => {
  try {
    const steamKey = (process.env.STEAM_API_KEY || "").trim();
    if (!steamKey) {
      return res.status(400).json({
        success: false,
        message: "Chave da API Steam não configurada. Adicione-a na página de Configurações.",
      });
    }

    const candidateGames = games.filter((g) => {
      if (g.steamId) return true;
      const detected = detectLocalSteamAppId(g.resolvedExe || g.file);
      if (detected) {
        g.steamId = detected;
        return true;
      }
      return false;
    });

    if (candidateGames.length === 0) {
      return res.json({
        success: true,
        message: "Nenhum jogo com Steam AppID encontrado na biblioteca.",
        total: 0,
        synced: 0,
      });
    }

    const steamId64 =
      (process.env.STEAM_USER_ID || "").trim() || detectLocalSteamUser().steamId64;
    let synced = 0;
    const errors = [];

    for (const g of candidateGames) {
      try {
        await syncGameAchievements(
          g.id,
          g.steamId,
          steamKey,
          steamId64,
          g.resolvedExe || g.file
        );
        synced++;
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        errors.push({ id: g.id, name: g.name, error: err.message });
      }
    }

    if (synced > 0) {
      savePlaytimeJson().catch(() => {});
    }

    res.json({
      success: true,
      total: candidateGames.length,
      synced,
      errors: errors.length > 0 ? errors : undefined,
      message: `Sincronização concluída: ${synced} de ${candidateGames.length} jogos sincronizados.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// ABRIR JOGO
// =========================

app.post("/play", systemActionLimiter, async (req, res) => {
  const { id } = req.body;
  const game = games.find((g) => g.id === id);

  if (!game) {
    return res.status(404).json({
      success: false,
      message: "Jogo não encontrado",
    });
  }

  // Iniciado pelo launcher: volta a ser monitorado normalmente
  ignoredDetections.delete(game.id);

  console.log(`Abrindo: ${game.name}`);

  try {
    let exeName = game.resolvedExe;
    let steamId = game.steamId;

    let targetPath = game.file;
    let workingDir = path.dirname(game.file);
    let launchArgs = "";

    if (game.extension === ".lnk") {
      const shortcut = await resolveShortcut(game.file);
      if (shortcut?.target) {
        if (!exeName) exeName = path.basename(shortcut.target);
        if (fs.existsSync(shortcut.target)) {
          targetPath = shortcut.target;
          workingDir =
            shortcut.workingDir && fs.existsSync(shortcut.workingDir)
              ? shortcut.workingDir
              : path.dirname(shortcut.target);
          launchArgs = shortcut.args || "";
        }
      } else if (!exeName) {
        exeName = path.basename(game.file, ".lnk") + ".exe";
      }
    } else if (game.extension === ".url") {
      if (!exeName) exeName = path.basename(game.file, ".url") + ".exe";
      if (steamId) {
        targetPath = `steam://rungameid/${steamId}`;
        workingDir = "";
      }
    } else {
      if (!exeName) exeName = path.basename(game.file);
    }

    // Inicia o jogo na área de trabalho interativa visível (Shell.Application / WinSta0\Default)
    const launchPayload = Buffer.from(
      `${targetPath}|${workingDir}|${launchArgs}`,
      "utf8"
    ).toString("base64");
    const launchOut = await runSysControl("launchb64", launchPayload);
    if (launchOut) {
      console.log(`[Launch] ${game.name}: ${launchOut}`);
    }

    const nowIso = new Date().toISOString();
    await dbRun(
      `UPDATE games SET play_count = COALESCE(play_count, 0) + 1, last_played = ? WHERE id = ?`,
      [nowIso, game.id]
    );
    game.playCount = (game.playCount || 0) + 1;
    game.lastPlayed = nowIso;
    await savePlaytimeJson();

    const newActiveGame = {
      id: game.id,
      name: game.name,
      file: game.file,
      extension: game.extension,
      cover: game.cover,
      pid: null,
      exeName: exeName,
      candidateExes: game.candidateExes || [exeName].filter(Boolean),
      steamId: steamId,
      startedAt: nowIso,
      initialPlayTime: game.playTime || 0,
      seenRunning: false,
    };

    activeGames.set(game.id, newActiveGame);
    activeGame = newActiveGame;
    wsManager.broadcastActiveGames({ startedGame: newActiveGame });

    // Detecta o PID nos primeiros segundos
    setTimeout(async () => {
      const target = activeGames.get(game.id);
      if (target && !target.pid) {
        const found = await findAnyProcessPid(target.candidateExes || [target.exeName]);
        if (found && activeGames.has(game.id)) {
          target.pid = found.pid;
          target.exeName = found.exeName;
          target.seenRunning = true;
          console.log(`PID detectado para ${target.name}: ${found.pid} (${found.exeName})`);
          wsManager.broadcastActiveGames();
        }
      }
    }, 2000);

    res.json({
      success: true,
      game: game.name,
      activeGame: newActiveGame,
      activeGames: Array.from(activeGames.values()),
      count: activeGames.size,
    });
  } catch (error) {
    console.error("Erro ao abrir jogo:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao abrir jogo: " + error.message,
    });
  }
});

// =========================
// CONTROLE REMOTO DO SISTEMA
// =========================

// Sincroniza o estado dos jogos ativos com os processos reais do Windows:
//  - para cada jogo ativo: confirma que ainda está rodando e encerra a respectiva sessão quando fechar;
//  - varre o sistema para detectar novos jogos abertos (fora do launcher ou simultâneos).
let syncingActiveGame = null;

function syncActiveGameState() {
  if (syncingActiveGame) return syncingActiveGame;

  syncingActiveGame = (async () => {
    try {
      const runningSteamAppId = await getSteamRunningAppId();

      // 1. Verifica individualmente cada jogo monitorado em activeGames
      for (const [gameId, ag] of Array.from(activeGames.entries())) {
        const ageMs = Date.now() - new Date(ag.startedAt).getTime();
        const exeCandidates = ag.candidateExes || [ag.exeName].filter(Boolean);

        if (ag.steamId && ag.extension === ".url") {
          if (runningSteamAppId === ag.steamId) {
            ag.seenRunning = true;
          } else if (ag.seenRunning) {
            console.log(`[Auto-Detect] O jogo ${ag.name} (Steam) foi fechado no PC.`);
            await finishActiveGameSession(gameId);
          }
        } else if (ag.pid) {
          const alive = await isPidRunning(ag.pid);
          if (alive) {
            ag.seenRunning = true;
          } else {
            const found = await findAnyProcessPid(exeCandidates);
            if (found) {
              ag.pid = found.pid;
              ag.exeName = found.exeName;
              ag.seenRunning = true;
            } else if (ag.seenRunning || ageMs > 25000) {
              console.log(`[Auto-Detect] O jogo ${ag.name} foi fechado no PC.`);
              await finishActiveGameSession(gameId);
            }
          }
        } else if (exeCandidates.length > 0) {
          const found = await findAnyProcessPid(exeCandidates);
          if (found) {
            ag.pid = found.pid;
            ag.exeName = found.exeName;
            ag.seenRunning = true;
          } else if (ag.extension !== ".url" && ageMs > 30000) {
            console.log(`[Auto-Detect] Processo ${ag.exeName} não encontrado após 30s.`);
            await finishActiveGameSession(gameId);
          }
        }
      }

      // 2. Busca todos os jogos da biblioteca atualmente em execução no Windows (se autoDetectGames estiver ativo)
      if (automationSettings.autoDetectGames !== false) {
        const candidates = await detectExternalGames();
        for (const candidate of candidates) {
          if (!activeGames.has(candidate.game.id)) {
            await adoptDetectedGame(candidate);
          }
        }
      }

      // 3. Mantém activeGame coerente para rotas e componentes retrocompatíveis
      if (activeGames.size > 0) {
        if (!activeGame || !activeGames.has(activeGame.id)) {
          activeGame = activeGames.values().next().value;
        }
      } else {
        activeGame = null;
      }
    } catch (err) {
      console.error("Erro sincronizando jogos ativos:", err.message);
    } finally {
      syncingActiveGame = null;
    }
  })();

  return syncingActiveGame;
}

// Consulta jogos em execução (suporta múltiplos) + detecção automática de abertura/fechamento
app.get("/system/active-game", async (req, res) => {
  await syncActiveGameState();

  const list = Array.from(activeGames.values());
  res.json({
    activeGame: activeGame || list[0] || null,
    activeGames: list,
    hasMultiple: list.length > 1,
    count: list.length,
  });
});

// Monitor em segundo plano: mantém o tempo de jogo correto mesmo sem nenhum app aberto no navegador
let activeGameMonitorTimer = null;

function restartActiveGameMonitor() {
  if (activeGameMonitorTimer) {
    clearInterval(activeGameMonitorTimer);
  }
  const intervalMs =
    Math.max(
      3,
      Math.min(
        60,
        Number(automationSettings.monitorIntervalSec) ||
          ACTIVE_GAME_MONITOR_INTERVAL_MS / 1000
      )
    ) * 1000;
  activeGameMonitorTimer = setInterval(syncActiveGameState, intervalMs);
}

restartActiveGameMonitor();

// Fechar jogo: separa fechamento suave (Alt+F4) de fechamento forçado (Taskkill)
app.post("/system/close-game", systemActionLimiter, async (req, res) => {
  const defaultForce = automationSettings.defaultCloseMode !== "soft";
  const { force = defaultForce, id, exeName: customExe } = req.body || {};
  const current = (id && activeGames.get(id)) || activeGame;

  // Modo suave (Alt+F4): envia apenas Alt+F4 para a janela em foco sem matar o processo com taskkill
  if (!force) {
    try {
      await runSysControl("altf4");
    } catch {}

    // Verifica após 1.5s se o processo encerrou; de qualquer forma registra a sessão
    setTimeout(async () => {
      const targetToCheck = (id && activeGames.get(id)) || activeGame;
      if (targetToCheck) {
        const stillAlive = targetToCheck.pid
          ? await isPidRunning(targetToCheck.pid)
          : Boolean(await findAnyProcessPid(targetToCheck.candidateExes || [targetToCheck.exeName]));
        if (!stillAlive) {
          await finishActiveGameSession(targetToCheck.id);
        }
      }
    }, 1500);

    const closed = await finishActiveGameSession(id || current?.id);
    return res.json({
      success: true,
      message: current ? `Alt+F4 enviado para ${current.name}.` : "Alt+F4 enviado para a janela atual.",
      closed,
      activeGames: Array.from(activeGames.values()),
    });
  }

  // Modo forçado (Taskkill)
  const imTargets = new Set();
  const pidTargets = new Set();

  if (current) {
    if (current.pid) pidTargets.add(current.pid);
    if (current.exeName) imTargets.add(current.exeName);
    if (Array.isArray(current.candidateExes)) {
      for (const exe of current.candidateExes) imTargets.add(exe);
    }
  }

  if (id) {
    const g = games.find((item) => item.id === id);
    if (g) {
      if (g.resolvedExe) imTargets.add(g.resolvedExe);
      if (Array.isArray(g.candidateExes)) {
        for (const exe of g.candidateExes) imTargets.add(exe);
      }
    }
  }

  // Valida customExe contra os executáveis conhecidos na biblioteca para impedir injeção
  if (customExe && typeof customExe === "string") {
    const normalizedExe = customExe.trim().toLowerCase();
    for (const item of games) {
      const candidates = item.candidateExes || [item.resolvedExe].filter(Boolean);
      for (const c of candidates) {
        if (c && c.toLowerCase() === normalizedExe) {
          imTargets.add(c);
        }
      }
    }
  }

  console.log(`[Taskkill] PIDs:`, Array.from(pidTargets), `Executáveis:`, Array.from(imTargets));

  for (const pid of pidTargets) {
    const numericPid = Number(pid);
    if (Number.isInteger(numericPid) && numericPid > 0) {
      await runSysControl("killpid", String(numericPid));
      execFile("taskkill.exe", ["/F", "/PID", String(numericPid), "/T"], { windowsHide: true }, () => {});
    }
  }

  for (const im of imTargets) {
    if (typeof im === "string" && /^[^"\\/:*?<>|\r\n]+\.exe$/i.test(im)) {
      await runSysControl("killname", im);
      execFile("taskkill.exe", ["/F", "/IM", im, "/T"], { windowsHide: true }, () => {});
    }
  }

  // Só mata a janela em primeiro plano se não havia alvo específico identificado
  if (pidTargets.size === 0 && imTargets.size === 0) {
    try {
      await runSysControl("killforeground");
    } catch {}
  }

  const closed = await finishActiveGameSession(id || current?.id);

  res.json({
    success: true,
    message: current ? `Jogo ${current.name} encerrado via Taskkill.` : "Processo em primeiro plano encerrado.",
    closed,
    activeGames: Array.from(activeGames.values()),
  });
});

// Limpar estado do jogo ativo manualmente (salva sessão até o momento)
app.post("/system/clear-active", async (req, res) => {
  const { id } = req.body || {};
  if (id) {
    await finishActiveGameSession(id);
  } else {
    for (const gId of Array.from(activeGames.keys())) {
      await finishActiveGameSession(gId);
    }
  }
  res.json({ success: true, activeGames: [] });
});

// Monitor de Desempenho do PC (CPU, RAM, Uptime)
app.get("/system/stats", (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramPercent = Math.round((usedMem / totalMem) * 100);

  res.json({
    cpuPercent: currentCpuUsage,
    ramPercent,
    ramUsedGB: (usedMem / (1024 ** 3)).toFixed(1),
    ramTotalGB: (totalMem / (1024 ** 3)).toFixed(1),
    uptimeHours: (os.uptime() / 3600).toFixed(1),
    hostname: os.hostname(),
  });
});

// Status de Áudio (Volume atual + Dispositivos de saída do Windows)
app.get("/system/audio", async (req, res) => {
  try {
    const [volRaw, devRaw] = await Promise.all([
      runSysControl("getvol"),
      runSysControl("getaudiodevices"),
    ]);

    let volData = {
      volume: wsManager.audioState.volume ?? 50,
      muted: Boolean(wsManager.audioState.muted),
    };
    let devices = wsManager.audioState.devices || [];

    try {
      volData = JSON.parse(volRaw);
    } catch {}

    try {
      devices = JSON.parse(devRaw);
    } catch {}

    const resolvedVol = typeof volData.volume === "number" ? volData.volume : 50;
    const resolvedMuted = Boolean(volData.muted);
    const resolvedDevices = Array.isArray(devices) ? devices : [];

    wsManager.audioState.volume = resolvedVol;
    wsManager.audioState.muted = resolvedMuted;
    wsManager.audioState.devices = resolvedDevices;

    res.json({
      volume: resolvedVol,
      muted: resolvedMuted,
      devices: resolvedDevices,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Trocar dispositivo de saída de áudio padrão do Windows (ex.: TV HDMI <-> Headset)
app.post("/system/audio/device", async (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ success: false, message: "deviceId obrigatório" });
  }
  try {
    const currentRaw = await runSysControl("getaudiodevices");
    let currentDevices = [];
    try {
      currentDevices = JSON.parse(currentRaw);
    } catch {}
    const matched = Array.isArray(currentDevices)
      ? currentDevices.find((d) => d && d.id === deviceId)
      : null;
    if (!matched) {
      return res.status(400).json({ success: false, message: "Dispositivo de áudio inválido" });
    }

    await runSysControl("setaudiodevice", matched.id);
    const devRaw = await runSysControl("getaudiodevices");
    let devices = [];
    try {
      devices = JSON.parse(devRaw);
    } catch {}
    wsManager.audioState.devices = Array.isArray(devices) ? devices : [];
    wsManager.broadcast({
      type: "VOLUME_UPDATE",
      value: wsManager.audioState.volume,
      is_muted: wsManager.audioState.muted,
      volume: wsManager.audioState.volume,
      muted: wsManager.audioState.muted,
      devices: wsManager.audioState.devices,
      source: "device_switch",
    });
    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Status da Tela / Modo de exibição atual (Tela do PC vs TV)
app.get("/system/display", async (req, res) => {
  try {
    const raw = await runSysControl("getdisplay");
    let displayData = { mode: "internal", label: "Tela do PC" };
    try {
      if (raw && raw.trim().startsWith("{")) {
        displayData = JSON.parse(raw.trim());
      }
    } catch {}
    res.json({
      success: true,
      mode: displayData.mode || "internal",
      label: displayData.label || "Tela do PC",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Alternar ou definir tela (Tela do computador somente <-> Segunda tela somente)
app.post("/system/display", async (req, res) => {
  const { mode } = req.body || {};
  const safeMode = String(mode || "toggle").toLowerCase().trim();

  try {
    let out = "";
    if (safeMode === "toggle") {
      out = await runSysControl("toggledisplay");
    } else if (["internal", "external", "clone", "extend", "pc", "tv"].includes(safeMode)) {
      const target = safeMode === "tv" ? "external" : safeMode === "pc" ? "internal" : safeMode;
      out = await runSysControl("setdisplay", target);
      const switchArg = target === "external" ? "/external" : "/internal";
      execFile("DisplaySwitch.exe", [switchArg], { windowsHide: true }, () => {});
    } else {
      return res.status(400).json({ success: false, message: "Modo de tela inválido" });
    }

    let parsed = null;
    try {
      if (out && out.trim().startsWith("{")) {
        parsed = JSON.parse(out.trim());
      }
    } catch {}

    const resolvedMode = parsed?.mode || (safeMode === "tv" ? "external" : safeMode === "pc" ? "internal" : safeMode);
    const label = parsed?.label || (resolvedMode === "external" ? "TV (Segunda tela somente)" : "Tela do PC (Tela do computador somente)");

    wsManager.broadcastDisplayMode({ mode: resolvedMode, label });

    res.json({
      success: true,
      mode: resolvedMode,
      label,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Controle de Volume do Windows (+, -, Mudo e Slider 0-100% com coalescência)
app.post("/system/volume", async (req, res) => {
  const { action, value } = req.body || {};
  try {
    const stepNum = Math.max(1, Math.min(20, Math.round(Number(automationSettings.volumeStep) || 3)));
    if (action === "up" || action === "down") {
      const delta = action === "down" ? -stepNum : stepNum;
      const clamped = Math.max(0, Math.min(100, Math.round((wsManager.audioState.volume ?? 50) + delta)));
      wsManager.applyVolumeFromClient(null, {
        mode: "set",
        value: clamped,
        muted: delta > 0 ? false : wsManager.audioState.muted,
      });
      return res.json({
        success: true,
        action,
        volume: wsManager.audioState.volume,
        muted: wsManager.audioState.muted,
      });
    } else if (action === "mute") {
      wsManager.applyVolumeFromClient(null, {
        mode: "mute",
        value: wsManager.audioState.volume,
        muted: !wsManager.audioState.muted,
      });
      return res.json({
        success: true,
        action,
        volume: wsManager.audioState.volume,
        muted: wsManager.audioState.muted,
      });
    } else if (action === "set" && typeof value === "number") {
      const clamped = Math.max(0, Math.min(100, Math.round(value)));
      wsManager.applyVolumeFromClient(null, {
        mode: "set",
        value: clamped,
        muted: clamped === 0 ? wsManager.audioState.muted : false,
      });
      return res.json({ success: true, action, volume: clamped, muted: false });
    } else {
      return res.status(400).json({ success: false, message: "Ação de volume inválida" });
    }
  } catch (error) {
    console.error("Erro volume:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Controle de Mídia (Play/Pause, Next, Prev)
app.post("/system/media", async (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === "play_pause") {
      await runSysControl("playpause");
    } else if (action === "next") {
      await runSysControl("next");
    } else if (action === "prev") {
      await runSysControl("prev");
    } else {
      return res.status(400).json({ success: false, message: "Ação de mídia inválida" });
    }
    res.json({ success: true, action });
  } catch (error) {
    console.error("Erro mídia:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Touchpad Virtual (Mover cursor com fila coalescida, Clique esquerdo/direito/duplo, Scroll)
let pendingMouseDx = 0;
let pendingMouseDy = 0;
let flushingMouse = false;

async function flushMouseMove() {
  if (flushingMouse) return;
  flushingMouse = true;
  while (pendingMouseDx !== 0 || pendingMouseDy !== 0) {
    const dx = Math.round(pendingMouseDx);
    const dy = Math.round(pendingMouseDy);
    pendingMouseDx = 0;
    pendingMouseDy = 0;
    if (dx !== 0 || dy !== 0) {
      await runSysControl("mousemove", String(dx), String(dy));
    }
  }
  flushingMouse = false;
}

app.post("/system/mouse", async (req, res) => {
  const { action, dx = 0, dy = 0, button = "left", delta = 0 } = req.body || {};
  try {
    if (action === "move") {
      pendingMouseDx += Number(dx) || 0;
      pendingMouseDy += Number(dy) || 0;
      flushMouseMove();
      return res.json({ success: true });
    } else if (action === "click") {
      const safeButton = button === "right" ? "right" : button === "double" ? "double" : "left";
      await runSysControl("mouseclick", safeButton);
    } else if (action === "scroll") {
      await runSysControl("mousescroll", String(Math.round(Number(delta) || 0)));
    } else {
      return res.status(400).json({ success: false, message: "Ação de mouse inválida" });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Teclado Virtual e Teclas de Ação Rápida
const VALID_KEYS = new Set([
  "alttab",
  "altf4",
  "escape",
  "enter",
  "backspace",
  "space",
  "tab",
  "up",
  "down",
  "left",
  "right",
  "win",
  "wind",
]);

app.post("/system/key", async (req, res) => {
  const { key } = req.body || {};
  try {
    if (!VALID_KEYS.has(key)) {
      return res.status(400).json({ success: false, message: "Tecla inválida" });
    }
    await runSysControl(key);
    res.json({ success: true, key });
  } catch (error) {
    console.error("Erro tecla:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/system/keyboard", async (req, res) => {
  const { text, submitEnter = false } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ success: false, message: "Texto inválido" });
  }
  try {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    await runSysControl("typetext", b64);
    if (submitEnter) {
      await runSysControl("enter");
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Controle de Energia (Suspender, Desligar, Reiniciar, Cancelar)
app.post("/system/power", systemActionLimiter, async (req, res) => {
  const { action } = req.body || {};
  const timerSec = Math.max(
    5,
    Math.min(3600, Math.round(Number(automationSettings.shutdownTimerSec) || 30))
  );
  try {
    if (action === "sleep") {
      runSysControl("sleep");
    } else if (action === "shutdown") {
      execFile(
        "shutdown.exe",
        ["/s", "/t", String(timerSec), "/c", `GameLauncher: Desligando PC em ${timerSec}s`],
        { windowsHide: true },
        () => {}
      );
    } else if (action === "restart") {
      execFile(
        "shutdown.exe",
        ["/r", "/t", String(timerSec), "/c", `GameLauncher: Reiniciando PC em ${timerSec}s`],
        { windowsHide: true },
        () => {}
      );
    } else if (action === "cancel") {
      execFile("shutdown.exe", ["/a"], { windowsHide: true }, () => {});
    } else {
      return res.status(400).json({ success: false, message: "Ação de energia inválida" });
    }
    res.json({ success: true, action, timerSec });
  } catch (error) {
    console.error("Erro energia:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Wake-on-LAN (Disparo de Magic Packet UDP)
app.post("/system/wake", systemActionLimiter, (req, res) => {
  const dgram = require("dgram");
  const targetMac = (req.body?.mac || process.env.TARGET_MAC || process.env.WOL_MAC || "").trim();

  // Função para criar o Magic Packet de 102 bytes
  function createMagicPacket(macAddress) {
    const cleanMac = macAddress.replace(/[^0-9A-Fa-f]/g, "");
    if (cleanMac.length !== 12) {
      throw new Error("Endereço MAC inválido. Formato esperado: AA:BB:CC:DD:EE:FF");
    }
    const macBuffer = Buffer.from(cleanMac, "hex");
    const magicPacket = Buffer.alloc(102);
    // 6 bytes de 0xFF
    magicPacket.fill(0xff, 0, 6);
    // 16 repetições do MAC
    for (let i = 0; i < 16; i++) {
      macBuffer.copy(magicPacket, 6 + i * 6, 0, 6);
    }
    return magicPacket;
  }

  // Tenta resolver o MAC se não tiver sido especificado explicitamente
  let macToSend = targetMac;
  if (!macToSend) {
    const nics = os.networkInterfaces();
    for (const name of Object.keys(nics)) {
      for (const net of nics[name]) {
        if (!net.internal && net.mac && net.mac !== "00:00:00:00:00:00") {
          macToSend = net.mac;
          break;
        }
      }
      if (macToSend) break;
    }
  }

  if (!macToSend) {
    return res.status(400).json({
      success: false,
      message: "Endereço MAC não configurado no .env (TARGET_MAC) nem informado na requisição.",
    });
  }

  try {
    const packet = createMagicPacket(macToSend);
    const client = dgram.createSocket("udp4");

    client.on("error", (err) => {
      console.error("[Wake-on-LAN] Erro de socket:", err);
      client.close();
    });

    client.bind(() => {
      client.setBroadcast(true);
      const broadcastIp = process.env.WOL_BROADCAST || "255.255.255.255";
      client.send(packet, 0, packet.length, 9, broadcastIp, (err) => {
        client.close();
        if (err) {
          console.error("[Wake-on-LAN] Falha ao enviar pacote:", err);
          return res.status(500).json({ success: false, message: "Falha ao enviar Magic Packet." });
        }
        console.log(`[Wake-on-LAN] Magic Packet transmitido com sucesso para ${macToSend} via ${broadcastIp}:9`);
        return res.json({
          success: true,
          message: `Magic Packet transmitido para ${macToSend}`,
          mac: macToSend,
        });
      });
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// =========================
// SERVER & WEBSOCKET (/ws)
// =========================

const server = http.createServer(app);

wsManager.configure({
  sysControlBin: SYSCONTROL_BIN,
  runSysControl,
  isAllowedClientIp,
  isAllowedOrigin,
  verifyToken: (token) => verifyTokenTimingSafe(token, API_TOKEN),
  getHostStatusPayload: () => ({
    status: "online",
    games: games.length,
    serverIp: SERVER_IP,
    port: PORT,
    frontendPort: FRONTEND_PORT,
  }),
  getActiveGamesPayload: () => {
    const list = Array.from(activeGames.values());
    return {
      activeGame: activeGame || list[0] || null,
      activeGames: list,
      hasMultiple: list.length > 1,
      count: list.length,
    };
  },
  getSystemStatsPayload: () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPercent = Math.round((usedMem / totalMem) * 100);
    return {
      cpuPercent: currentCpuUsage,
      ramPercent,
      ramUsedGB: (usedMem / (1024 ** 3)).toFixed(1),
      ramTotalGB: (totalMem / (1024 ** 3)).toFixed(1),
      uptimeHours: (os.uptime() / 3600).toFixed(1),
      hostname: os.hostname(),
    };
  },
  getDisplayPayload: async () => {
    try {
      const raw = await runSysControl("getdisplay");
      let displayData = { mode: "internal", label: "Tela do PC" };
      if (raw && raw.trim().startsWith("{")) {
        displayData = JSON.parse(raw.trim());
      }
      return {
        mode: displayData.mode || "internal",
        label: displayData.label || "Tela do PC",
      };
    } catch {
      return null;
    }
  },
  getVolumeStep: () =>
    Math.max(1, Math.min(20, Math.round(Number(automationSettings.volumeStep) || 3))),
});

wsManager.attachServer(server);

server.listen(PORT, "0.0.0.0", () => {
  console.clear();

  console.log(`
=================================
       GameLauncher Server
=================================

API (Backend):
http://${SERVER_IP}:${PORT}

WebSocket (Real-Time):
ws://${SERVER_IP}:${PORT}/ws

App (Frontend):
http://${SERVER_IP}:${FRONTEND_PORT}

Jogos:
${games.length}

=================================
`);
});