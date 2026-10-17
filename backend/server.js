const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const { exec } = require("child_process");
const axios = require("axios");

const { getGameCover, searchGameCovers } = require("./services/steamgriddb");
const { dbRun, dbGet, dbAll, initDatabase } = require("./database");

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

app.use(cors());
app.use(express.json());

// Logger de requisições (ignora spam de mousemove e polling frequente no console)
app.use((req, res, next) => {
  if (req.url !== "/system/mouse" && req.url !== "/system/active-game" && req.url !== "/system/stats") {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  }
  next();
});

// =========================
// CONFIGURAÇÕES (via .env)
// =========================

const PORT = process.env.PORT;
const FRONTEND_PORT = process.env.FRONTEND_PORT;
const GAME_FOLDER = process.env.GAME_FOLDER;
const SERVER_IP = process.env.SERVER_IP;

const COVER_FOLDER = path.join(__dirname, "covers");
const SYSCONTROL_BIN = path.join(__dirname, "syscontrol.exe");

if (!fs.existsSync(COVER_FOLDER)) {
  fs.mkdirSync(COVER_FOLDER, { recursive: true });
}

function runSysControl(action, param = "") {
  return new Promise((resolve) => {
    exec(`"${SYSCONTROL_BIN}" ${action} ${param}`, { encoding: "utf8" }, (err, stdout, stderr) => {
      resolve((stdout || stderr || "").trim());
    });
  });
}

function findProcessPid(exeName) {
  return new Promise((resolve) => {
    if (!exeName) return resolve(null);
    exec(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const lines = stdout
        .trim()
        .split("\n")
        .filter((l) => l.toLowerCase().includes(exeName.toLowerCase()));
      if (lines.length === 0) return resolve(null);
      const parts = lines[0].split(",").map((p) => p.replace(/"/g, "").trim());
      const pid = parseInt(parts[1], 10);
      resolve(pid || null);
    });
  });
}

function isPidRunning(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false);
    exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      resolve(stdout.includes(`"${pid}"`));
    });
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

async function downloadCover(gameName, customImageUrl = null, forceOverwrite = false) {
  const baseSlug = sanitizeCoverName(gameName);
  const fileName = forceOverwrite ? `${baseSlug}-${Date.now()}.jpg` : `${baseSlug}.jpg`;
  const filePath = path.join(COVER_FOLDER, fileName);

  if (!forceOverwrite && fs.existsSync(filePath)) {
    return fileName;
  }

  const imageUrl = customImageUrl || (await getGameCover(gameName));
  if (!imageUrl) {
    return null;
  }

  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
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
}

// =========================
// CARREGA E SINCRONIZA JOGOS (PARALELO + SQLITE)
// =========================

async function loadGames() {
  await initDatabase();

  if (!GAME_FOLDER) {
    console.log("GAME_FOLDER não configurado no .env");
    return;
  }

  if (!fs.existsSync(GAME_FOLDER)) {
    console.log("Pasta de jogos não encontrada:", GAME_FOLDER);
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
      let steamId = null;

      if (ext === ".lnk") {
        const sc = await resolveShortcut(file);
        if (sc && sc.target) {
          resolvedExe = path.basename(sc.target);
        } else {
          resolvedExe = rawName + ".exe";
        }
      } else if (ext === ".url") {
        try {
          const content = fs.readFileSync(file, "utf-8");
          const match = content.match(/steam:\/\/rungameid\/(\d+)/i);
          if (match) steamId = match[1];
        } catch {}
        resolvedExe = rawName + ".exe";
      } else {
        resolvedExe = path.basename(file);
      }

      // Verifica se já existe no banco SQLite
      let dbRow = await dbGet("SELECT * FROM games WHERE path = ?", [file]);

      const searchTitle = dbRow?.custom_name || rawName;
      let cover = dbRow?.cover;

      // Verifica se o arquivo da capa existe no disco; se não, baixa
      if (!cover || !fs.existsSync(path.join(COVER_FOLDER, cover))) {
        cover = await downloadCover(searchTitle);
      }

      if (!dbRow) {
        const insertRes = await dbRun(
          `INSERT INTO games (name, custom_name, path, extension, cover, resolved_exe, steam_id, play_time, play_count, favorite, last_played)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL)`,
          [rawName, null, file, ext, cover, resolvedExe, steamId]
        );
        dbRow = await dbGet("SELECT * FROM games WHERE id = ?", [insertRes.lastID]);
      } else {
        await dbRun(
          `UPDATE games SET name = ?, extension = ?, cover = ?, resolved_exe = ?, steam_id = ? WHERE id = ?`,
          [rawName, ext, cover, resolvedExe, steamId, dbRow.id]
        );
        dbRow.name = rawName;
        dbRow.extension = ext;
        dbRow.cover = cover;
        dbRow.resolved_exe = resolvedExe;
        dbRow.steam_id = steamId;
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
        file: dbRow.path,
        extension: dbRow.extension,
        cover: dbRow.cover,
        resolvedExe: dbRow.resolved_exe,
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
  console.log(`${games.length} jogos sincronizados com SQLite (incluindo dados da Steam).`);
}

// Encerra sessão ativa e grava tempo jogado no SQLite
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

    console.log(`[Sessão] ${closed.name} finalizado. Duração: ${durationSec}s (Total: ${newPlayTime}s)`);
  } catch (err) {
    console.error("Erro salvando sessão:", err.message);
  }

  ignoreDetectionFor(closed);

  return closed;
}

// =========================
// DETECÇÃO AUTOMÁTICA DE JOGOS ABERTOS FORA DO LAUNCHER
// =========================

const ACTIVE_GAME_MONITOR_INTERVAL_MS = 8000;
const PROCESS_LIST_CACHE_MS = 3000;
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

// Índice executável -> jogo. Descarta executáveis genéricos e os compartilhados por mais de
// um jogo (ex.: um mesmo launcher em vários atalhos), pois não dá para saber qual deles está aberto.
function buildExecutableIndex() {
  const byExe = new Map();

  for (const game of games) {
    if (game.extension === ".url") continue;
    const exe = (game.resolvedExe || "").toLowerCase();
    if (!exe.endsWith(".exe") || GENERIC_EXECUTABLES.has(exe)) continue;
    if (!byExe.has(exe)) byExe.set(exe, []);
    byExe.get(exe).push(game);
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

  if (steamAppId) {
    const steamGame = games.find((g) => g.extension === ".url" && g.steamId === steamAppId);
    if (steamGame) {
      candidates.push({ game: steamGame, via: "steam", pid: null, token: `steam:${steamAppId}` });
    }
  }

  for (const [exe, [game]] of buildExecutableIndex()) {
    const pid = processes.get(exe);
    if (pid) candidates.push({ game, via: "exe", pid, token: `pid:${pid}` });
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
async function adoptDetectedGame({ game, via, pid }) {
  if (activeGames.has(game.id)) return;

  const startedAt = (pid && (await getProcessStartTime(pid))) || new Date().toISOString();
  if (activeGames.has(game.id)) return;

  const newActive = {
    id: game.id,
    name: game.name,
    file: game.file,
    extension: game.extension,
    cover: game.cover,
    pid: pid || null,
    exeName: game.resolvedExe,
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
    await dbRun(
      `UPDATE games SET play_count = COALESCE(play_count, 0) + 1, last_played = ? WHERE id = ?`,
      [new Date().toISOString(), game.id]
    );
    game.playCount = (game.playCount || 0) + 1;
    game.lastPlayed = new Date().toISOString();
  } catch (err) {
    console.error("Erro atualizando jogo detectado:", err.message);
  }

  console.log(
    `[Auto-Detect] Jogo detectado fora do launcher: ${game.name} ` +
      `(${via === "steam" ? `Steam AppID ${game.steamId}` : `${game.resolvedExe}, PID ${pid}`})`
  );
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

  res.json(
    games.map((game) => ({
      id: game.id,
      name: game.name,
      originalName: game.originalName,
      customName: game.customName,
      cover: game.cover,
      extension: game.extension,
      resolvedExe: game.resolvedExe,
      playTime: game.playTime,
      playCount: game.playCount,
      favorite: game.favorite,
      lastPlayed: game.lastPlayed,
    }))
  );
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

// Editar nome de exibição e/ou trocar capa do jogo
app.put("/games/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const game = games.find((g) => g.id === id);
  if (!game) {
    return res.status(404).json({ success: false, message: "Jogo não encontrado" });
  }

  const { customName, coverUrl } = req.body || {};

  try {
    if (typeof customName === "string") {
      const trimmed = customName.trim();
      game.customName = trimmed;
      game.name = trimmed || game.originalName;
      await dbRun(`UPDATE games SET custom_name = ? WHERE id = ?`, [trimmed || null, id]);
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
// ABRIR JOGO
// =========================

app.post("/play", async (req, res) => {
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

    if (game.extension === ".lnk") {
      const shortcut = await resolveShortcut(game.file);
      if (shortcut?.target) {
        if (!exeName) exeName = path.basename(shortcut.target);
        if (fs.existsSync(shortcut.target)) {
          targetPath = shortcut.target;
          workingDir = (shortcut.workingDir && fs.existsSync(shortcut.workingDir))
            ? shortcut.workingDir
            : path.dirname(shortcut.target);
        }
      } else if (!exeName) {
        exeName = path.basename(game.file, ".lnk") + ".exe";
      }
    } else if (game.extension === ".url") {
      if (!exeName) exeName = path.basename(game.file, ".url") + ".exe";
    } else {
      if (!exeName) exeName = path.basename(game.file);
    }

    // Inicia o jogo
    if (game.extension === ".url" && steamId) {
      exec(`cmd /c start "" "steam://rungameid/${steamId}"`);
    } else {
      exec(`cmd /c start "" "${targetPath}"`, { cwd: workingDir });
    }

    const nowIso = new Date().toISOString();
    await dbRun(
      `UPDATE games SET play_count = COALESCE(play_count, 0) + 1, last_played = ? WHERE id = ?`,
      [nowIso, game.id]
    );
    game.playCount = (game.playCount || 0) + 1;
    game.lastPlayed = nowIso;

    const newActiveGame = {
      id: game.id,
      name: game.name,
      file: game.file,
      extension: game.extension,
      cover: game.cover,
      pid: null,
      exeName: exeName,
      steamId: steamId,
      startedAt: nowIso,
      initialPlayTime: game.playTime || 0,
      seenRunning: false,
    };

    activeGames.set(game.id, newActiveGame);
    activeGame = newActiveGame;

    // Detecta o PID nos primeiros segundos
    setTimeout(async () => {
      const target = activeGames.get(game.id);
      if (target && !target.pid && exeName) {
        const detectedPid = await findProcessPid(exeName);
        if (detectedPid && activeGames.has(game.id)) {
          target.pid = detectedPid;
          target.seenRunning = true;
          console.log(`PID detectado para ${target.name}: ${detectedPid}`);
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
            const newPid = await findProcessPid(ag.exeName);
            if (newPid) {
              ag.pid = newPid;
              ag.seenRunning = true;
            } else if (ag.seenRunning || ageMs > 25000) {
              console.log(`[Auto-Detect] O jogo ${ag.name} foi fechado no PC.`);
              await finishActiveGameSession(gameId);
            }
          }
        } else if (ag.exeName) {
          const detectedPid = await findProcessPid(ag.exeName);
          if (detectedPid) {
            ag.pid = detectedPid;
            ag.seenRunning = true;
          } else if (ag.extension !== ".url" && ageMs > 30000) {
            console.log(`[Auto-Detect] Processo ${ag.exeName} não encontrado após 30s.`);
            await finishActiveGameSession(gameId);
          }
        }
      }

      // 2. Busca todos os jogos da biblioteca atualmente em execução no Windows
      const candidates = await detectExternalGames();
      for (const candidate of candidates) {
        if (!activeGames.has(candidate.game.id)) {
          await adoptDetectedGame(candidate);
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
setInterval(syncActiveGameState, ACTIVE_GAME_MONITOR_INTERVAL_MS);

// Fechar jogo: separa fechamento suave (Alt+F4) de fechamento forçado (Taskkill)
app.post("/system/close-game", async (req, res) => {
  const { force = true, id, exeName: customExe } = req.body || {};
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
          : await findProcessPid(targetToCheck.exeName);
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
  }

  if (id) {
    const g = games.find((item) => item.id === id);
    if (g && g.resolvedExe) imTargets.add(g.resolvedExe);
  }

  if (customExe) {
    imTargets.add(customExe);
  }

  console.log(`[Taskkill] PIDs:`, Array.from(pidTargets), `Executáveis:`, Array.from(imTargets));

  for (const pid of pidTargets) {
    await runSysControl("killpid", pid);
    exec(`taskkill /F /PID ${pid} /T`);
  }

  for (const im of imTargets) {
    await runSysControl("killname", `"${im}"`);
    exec(`taskkill /F /IM "${im}" /T`);
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

    let volData = { volume: 50, muted: false };
    let devices = [];

    try {
      volData = JSON.parse(volRaw);
    } catch {}

    try {
      devices = JSON.parse(devRaw);
    } catch {}

    res.json({
      volume: typeof volData.volume === "number" ? volData.volume : 50,
      muted: Boolean(volData.muted),
      devices: Array.isArray(devices) ? devices : [],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Trocar dispositivo de saída de áudio padrão do Windows (ex.: TV HDMI <-> Headset)
app.post("/system/audio/device", async (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ success: false, message: "deviceId obrigatório" });
  }
  try {
    await runSysControl("setaudiodevice", `"${deviceId}"`);
    const devRaw = await runSysControl("getaudiodevices");
    let devices = [];
    try {
      devices = JSON.parse(devRaw);
    } catch {}
    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Controle de Volume do Windows (+, -, Mudo e Slider 0-100% com coalescência)
let pendingVolumeVal = null;
let flushingVolume = false;

async function flushVolumeSet() {
  if (flushingVolume) return;
  flushingVolume = true;
  while (pendingVolumeVal !== null) {
    const val = pendingVolumeVal;
    pendingVolumeVal = null;
    await runSysControl("setvol", String(val));
  }
  flushingVolume = false;
}

app.post("/system/volume", async (req, res) => {
  const { action, value } = req.body || {};
  try {
    let out = "";
    if (action === "up") {
      out = await runSysControl("volup", "3");
    } else if (action === "down") {
      out = await runSysControl("voldown", "3");
    } else if (action === "mute") {
      out = await runSysControl("volmute");
    } else if (action === "set" && typeof value === "number") {
      const clamped = Math.max(0, Math.min(100, Math.round(value)));
      pendingVolumeVal = clamped;
      flushVolumeSet();
      return res.json({ success: true, action, volume: clamped, muted: false });
    } else {
      return res.status(400).json({ success: false, message: "Ação de volume inválida" });
    }

    let volState = {};
    try {
      volState = JSON.parse(out);
    } catch {}

    res.json({ success: true, action, ...volState });
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
      await runSysControl("mousemove", `${dx} ${dy}`);
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
      await runSysControl("mouseclick", button);
    } else if (action === "scroll") {
      await runSysControl("mousescroll", String(Math.round(delta)));
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
app.post("/system/power", async (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === "sleep") {
      runSysControl("sleep");
    } else if (action === "shutdown") {
      exec('shutdown /s /t 30 /c "GameLauncher: Desligando PC em 30s"');
    } else if (action === "restart") {
      exec('shutdown /r /t 30 /c "GameLauncher: Reiniciando PC em 30s"');
    } else if (action === "cancel") {
      exec("shutdown /a");
    } else {
      return res.status(400).json({ success: false, message: "Ação de energia inválida" });
    }
    res.json({ success: true, action });
  } catch (error) {
    console.error("Erro energia:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =========================
// SERVER
// =========================

app.listen(PORT, "0.0.0.0", () => {
  console.clear();

  console.log(`
=================================
       GameLauncher Server
=================================

API (Backend):
http://${SERVER_IP}:${PORT}

App (Frontend):
http://${SERVER_IP}:${FRONTEND_PORT}

Jogos:
${games.length}

=================================
`);
});