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
  console.log(`${games.length} jogos sincronizados com SQLite.`);
}

// Encerra sessão ativa e grava tempo jogado no SQLite
async function finishActiveGameSession() {
  if (!activeGame) return null;
  const closed = { ...activeGame };
  activeGame = null;

  try {
    const startedMs = new Date(closed.startedAt).getTime();
    const endedAt = new Date().toISOString();
    const durationSec = Math.max(1, Math.floor((Date.now() - startedMs) / 1000));

    await dbRun(
      `INSERT INTO sessions (game_id, started_at, ended_at, duration) VALUES (?, ?, ?, ?)`,
      [closed.id, closed.startedAt, endedAt, durationSec]
    );

    await dbRun(
      `UPDATE games SET play_time = COALESCE(play_time, 0) + ?, last_played = ? WHERE id = ?`,
      [durationSec, endedAt, closed.id]
    );

    const g = games.find((item) => item.id === closed.id);
    if (g) {
      g.playTime = (g.playTime || 0) + durationSec;
      g.lastPlayed = endedAt;
    }

    console.log(`[Sessão] ${closed.name} finalizado. Duração: ${durationSec}s`);
  } catch (err) {
    console.error("Erro salvando sessão:", err.message);
  }

  return closed;
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
app.get("/games", (req, res) => {
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

  // Se já havia outro jogo ativo, fecha a contagem da sessão anterior
  if (activeGame && activeGame.id !== game.id) {
    await finishActiveGameSession();
  }

  console.log(`Abrindo: ${game.name}`);

  try {
    let exeName = game.resolvedExe;
    let steamId = game.steamId;

    if (!exeName) {
      if (game.extension === ".lnk") {
        const shortcut = await resolveShortcut(game.file);
        exeName = shortcut?.target ? path.basename(shortcut.target) : path.basename(game.file, ".lnk") + ".exe";
      } else if (game.extension === ".url") {
        exeName = path.basename(game.file, ".url") + ".exe";
      } else {
        exeName = path.basename(game.file);
      }
    }

    // Inicia o jogo pelo Windows Desktop Shell
    try {
      await runSysControl("launch", `"${game.file}"`);
    } catch (launchErr) {
      console.warn("Fallback para cmd start:", launchErr.message);
      exec(`cmd /c start "" "${game.file}"`, { cwd: path.dirname(game.file) });
    }

    const nowIso = new Date().toISOString();
    await dbRun(
      `UPDATE games SET play_count = COALESCE(play_count, 0) + 1, last_played = ? WHERE id = ?`,
      [nowIso, game.id]
    );
    game.playCount = (game.playCount || 0) + 1;
    game.lastPlayed = nowIso;

    activeGame = {
      id: game.id,
      name: game.name,
      file: game.file,
      extension: game.extension,
      cover: game.cover,
      pid: null,
      exeName: exeName,
      steamId: steamId,
      startedAt: nowIso,
      seenRunning: false,
    };

    // Detecta o PID nos primeiros segundos
    setTimeout(async () => {
      if (activeGame && activeGame.id === game.id && !activeGame.pid && exeName) {
        const detectedPid = await findProcessPid(exeName);
        if (detectedPid && activeGame) {
          activeGame.pid = detectedPid;
          activeGame.seenRunning = true;
          console.log(`PID detectado para ${activeGame.name}: ${detectedPid}`);
        }
      }
    }, 2000);

    res.json({
      success: true,
      game: game.name,
      activeGame,
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

// Consulta jogo em execução + detecção automática se o processo já fechou
app.get("/system/active-game", async (req, res) => {
  if (activeGame) {
    const ageMs = Date.now() - new Date(activeGame.startedAt).getTime();

    if (activeGame.pid) {
      const alive = await isPidRunning(activeGame.pid);
      if (alive) {
        activeGame.seenRunning = true;
      } else {
        // Verifica se outro processo com o mesmo exeName assumiu (ex.: launcher -> jogo)
        const newPid = await findProcessPid(activeGame.exeName);
        if (newPid) {
          activeGame.pid = newPid;
          activeGame.seenRunning = true;
        } else if (activeGame.seenRunning || ageMs > 25000) {
          console.log(`[Auto-Detect] O jogo ${activeGame.name} foi fechado no PC.`);
          await finishActiveGameSession();
        }
      }
    } else if (activeGame.exeName) {
      const detectedPid = await findProcessPid(activeGame.exeName);
      if (detectedPid && activeGame) {
        activeGame.pid = detectedPid;
        activeGame.seenRunning = true;
      } else if (activeGame.extension !== ".url" && ageMs > 30000) {
        // Jogos .exe/.lnk que não estão mais rodando após 30s do início
        console.log(`[Auto-Detect] Processo ${activeGame.exeName} não encontrado após 30s.`);
        await finishActiveGameSession();
      }
    }
  }

  res.json({
    activeGame,
  });
});

// Fechar jogo: separa fechamento suave (Alt+F4) de fechamento forçado (Taskkill)
app.post("/system/close-game", async (req, res) => {
  const { force = true, id, exeName: customExe } = req.body || {};
  const current = activeGame;

  // Modo suave (Alt+F4): envia apenas Alt+F4 para a janela em foco sem matar o processo com taskkill
  if (!force) {
    try {
      await runSysControl("altf4");
    } catch {}

    // Verifica após 1.5s se o processo encerrou; de qualquer forma registra a sessão
    setTimeout(async () => {
      if (activeGame) {
        const stillAlive = activeGame.pid
          ? await isPidRunning(activeGame.pid)
          : await findProcessPid(activeGame.exeName);
        if (!stillAlive) {
          await finishActiveGameSession();
        }
      }
    }, 1500);

    const closed = await finishActiveGameSession();
    return res.json({
      success: true,
      message: current ? `Alt+F4 enviado para ${current.name}.` : "Alt+F4 enviado para a janela atual.",
      closed,
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

  const closed = await finishActiveGameSession();

  res.json({
    success: true,
    message: current ? `Jogo ${current.name} encerrado via Taskkill.` : "Processo em primeiro plano encerrado.",
    closed,
  });
});

// Limpar estado do jogo ativo manualmente (salva sessão até o momento)
app.post("/system/clear-active", async (req, res) => {
  await finishActiveGameSession();
  res.json({ success: true });
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