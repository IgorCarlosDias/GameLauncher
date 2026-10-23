const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { dbRun, dbAll, dbGet } = require("../database");

const STEAM_ID64_BASE = 76561197960265728n;

/**
 * Detecta a instalação local da Steam e o SteamID64 do usuário ativo no Windows
 */
function detectLocalSteamUser() {
  let steamPath = null;
  let activeAccountId = null;

  // 1. Tenta obter o caminho e o usuário ativo do Registro do Windows
  try {
    const steamPathOut = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const pathMatch = steamPathOut.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (pathMatch) {
      steamPath = path.normalize(pathMatch[1].trim());
    }
  } catch {
    // Fallback para caminhos padrão
    const fallbacks = [
      "C:\\Program Files (x86)\\Steam",
      "C:\\Program Files\\Steam",
    ];
    for (const fb of fallbacks) {
      if (fs.existsSync(fb)) {
        steamPath = fb;
        break;
      }
    }
  }

  try {
    const activeProcOut = execSync('reg query "HKCU\\Software\\Valve\\Steam\\ActiveProcess" /v ActiveUser', {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const userMatch = activeProcOut.match(/ActiveUser\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i);
    if (userMatch) {
      const parsed = parseInt(userMatch[1], 16);
      if (parsed > 0) {
        activeAccountId = parsed.toString();
      }
    }
  } catch {
    // Registry query failed or no active process
  }

  // 2. Se não encontrou o activeUser no registro, inspeciona a pasta userdata
  if (!activeAccountId && steamPath) {
    const userdataDir = path.join(steamPath, "userdata");
    if (fs.existsSync(userdataDir)) {
      try {
        const entries = fs.readdirSync(userdataDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d+$/.test(d.name) && d.name !== "0")
          .map((d) => {
            const fullPath = path.join(userdataDir, d.name);
            const stat = fs.statSync(fullPath);
            return { accountId: d.name, mtimeMs: stat.mtimeMs };
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs);

        if (entries.length > 0) {
          activeAccountId = entries[0].accountId;
        }
      } catch {
        // Ignora erro de leitura
      }
    }
  }

  let steamId64 = null;
  if (activeAccountId) {
    try {
      steamId64 = (BigInt(activeAccountId) + STEAM_ID64_BASE).toString();
    } catch {
      // BigInt error
    }
  }

  return {
    steamPath,
    accountId: activeAccountId,
    steamId64,
  };
}

/**
 * Testa a chave de API da Steam
 */
async function testSteamApiKey(apiKey, testSteamId = null) {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, message: "Chave da API Steam não fornecida" };
  }

  const cleanKey = apiKey.trim();

  try {
    // Testa com o jogo 440 (Team Fortress 2) que sempre tem catálogo de conquistas
    const schemaUrl = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${cleanKey}&appid=440`;
    const res = await axios.get(schemaUrl, { timeout: 8000 });

    if (!res.data || !res.data.game) {
      return { valid: false, message: "Resposta inválida da Steam API" };
    }

    let playerCheck = null;
    if (testSteamId && String(testSteamId).trim()) {
      const cleanSteamId = String(testSteamId).trim();
      try {
        const playerUrl = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=440&key=${cleanKey}&steamid=${cleanSteamId}`;
        const pRes = await axios.get(playerUrl, { timeout: 8000 });
        if (pRes.data?.playerstats?.success !== false) {
          playerCheck = {
            accessible: true,
            message: "Perfil público e acessível com sucesso!",
          };
        } else {
          playerCheck = {
            accessible: false,
            message: pRes.data?.playerstats?.error || "Perfil privado ou sem acesso",
          };
        }
      } catch (pErr) {
        if (pErr.response?.status === 403) {
          playerCheck = {
            accessible: false,
            message: "Perfil ou detalhes de jogos estão como PRIVADOS na Steam. Configure como Público.",
          };
        } else {
          playerCheck = {
            accessible: false,
            message: pErr.response?.data?.message || pErr.message,
          };
        }
      }
    }

    return {
      valid: true,
      message: "Chave da API Steam válida!",
      playerCheck,
    };
  } catch (err) {
    if (err.response?.status === 403) {
      return { valid: false, message: "Chave da API Steam recusada (403 Forbidden). Verifique a chave." };
    }
    return {
      valid: false,
      message: err.response?.data?.message || err.message,
    };
  }
}

/**
 * Busca esquema de conquistas de um jogo (nomes, descrições, ícones)
 */
async function fetchGameSchema(steamAppId, apiKey) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${steamAppId}&l=brazilian`;
  const res = await axios.get(url, { timeout: 10000 });
  const rawAchievements = res.data?.game?.availableGameStats?.achievements || [];

  return rawAchievements.map((a) => ({
    apiName: a.name,
    name: a.displayName || a.name,
    description: a.description || "",
    iconUrl: a.icon || "",
    iconGrayUrl: a.icongray || a.icon || "",
    hidden: a.hidden ? 1 : 0,
  }));
}

/**
 * Decodificador simples de formato binário Valve KeyValues (Binary VDF)
 * Usado pelo Steam para salvar UserGameStats e Schemas locais em appcache/stats/
 */
function parseBinaryVDF(buffer) {
  let offset = 0;

  function readString() {
    const start = offset;
    while (offset < buffer.length && buffer[offset] !== 0) {
      offset++;
    }
    const str = buffer.toString("utf8", start, offset);
    offset++; // Pula byte nulo
    return str;
  }

  function parseObject() {
    const obj = {};
    while (offset < buffer.length) {
      const type = buffer[offset++];
      if (type === 0x08) {
        break; // Fim do objeto
      }
      const key = readString();
      if (type === 0x00) {
        obj[key] = parseObject();
      } else if (type === 0x01) {
        obj[key] = readString();
      } else if (type === 0x02) {
        obj[key] = buffer.readInt32LE(offset);
        offset += 4;
      } else if (type === 0x03) {
        obj[key] = buffer.readFloatLE(offset);
        offset += 4;
      } else if (type === 0x04) {
        offset += 4;
      } else if (type === 0x05) {
        const start = offset;
        while (offset + 1 < buffer.length && !(buffer[offset] === 0 && buffer[offset + 1] === 0)) {
          offset += 2;
        }
        obj[key] = buffer.toString("utf16le", start, offset);
        offset += 2;
      } else if (type === 0x06) {
        offset += 4;
      } else if (type === 0x07) {
        obj[key] = buffer.readBigUInt64LE(offset).toString();
        offset += 8;
      } else {
        break;
      }
    }
    return obj;
  }

  return parseObject();
}

/**
 * Lê conquistas desbloqueadas do cache local da Steam oficial:
 * 1º - appcache/stats/UserGameStats_<accountId>_<appId>.bin + UserGameStatsSchema_<appId>.bin
 * 2º - userdata/<accountId>/config/librarycache/<appId>.json
 */
function readLocalPlayerAchievements(steamAppId, steamPath = null, accountId = null) {
  try {
    const local = detectLocalSteamUser();
    const effectiveSteamPath = steamPath || local.steamPath;
    const effectiveAccountId = accountId || local.accountId;

    if (!effectiveSteamPath || !effectiveAccountId) {
      return { map: new Map(), unachievedSet: new Set(), total: 0, unlocked: 0 };
    }

    const map = new Map();
    const unachievedSet = new Set();
    let total = 0;
    let unlocked = 0;

    // 1. Tenta carregar os dados binários do Steam Client (appcache/stats/)
    const statsFile = path.join(
      effectiveSteamPath,
      "appcache",
      "stats",
      `UserGameStats_${effectiveAccountId}_${steamAppId}.bin`
    );
    const schemaFile = path.join(
      effectiveSteamPath,
      "appcache",
      "stats",
      `UserGameStatsSchema_${steamAppId}.bin`
    );

    if (fs.existsSync(statsFile) && fs.existsSync(schemaFile)) {
      try {
        const statsVdf = parseBinaryVDF(fs.readFileSync(statsFile));
        const schemaVdf = parseBinaryVDF(fs.readFileSync(schemaFile));
        const appStats = schemaVdf[String(steamAppId)]?.stats || {};
        const cacheData = statsVdf.cache || {};

        for (const groupKey of Object.keys(appStats)) {
          const groupSchema = appStats[groupKey]?.bits || {};
          const groupStats = cacheData[groupKey] || {};
          const times = groupStats.AchievementTimes || {};
          const bitmask = Number(groupStats.data) || 0;

          for (const bitKey of Object.keys(groupSchema)) {
            const bitNum = parseInt(bitKey, 10);
            const achName = groupSchema[bitKey]?.name;
            if (!achName) continue;

            const isUnlocked = (times[bitKey] > 0) || ((bitmask & (1 << bitNum)) !== 0);

            if (isUnlocked) {
              map.set(achName, {
                achieved: 1,
                unlockTime: Number(times[bitKey]) || 0,
              });
            } else {
              unachievedSet.add(achName);
            }
          }
        }

        total = map.size + unachievedSet.size;
        unlocked = map.size;
      } catch (binErr) {
        console.warn(`[Steam Binary Stats] Erro ao parsear binários para app ${steamAppId}:`, binErr.message);
      }
    }

    // 2. Mescla ou complementa com librarycache/<steamAppId>.json
    const cacheFile = path.join(
      effectiveSteamPath,
      "userdata",
      String(effectiveAccountId),
      "config",
      "librarycache",
      `${steamAppId}.json`
    );

    if (fs.existsSync(cacheFile)) {
      try {
        const raw = fs.readFileSync(cacheFile, "utf8");
        const parsed = JSON.parse(raw);
        const achEntry = parsed.find((e) => Array.isArray(e) && e[0] === "achievements");
        if (achEntry && achEntry[1]?.data) {
          const data = achEntry[1].data;
          total = Number(data.nTotal) || total;
          unlocked = Number(data.nAchieved) || unlocked;

          const highlights = Array.isArray(data.vecHighlight) ? data.vecHighlight : [];
          const hiddenAchieved = Array.isArray(data.vecAchievedHidden) ? data.vecAchievedHidden : [];
          const unachievedList = Array.isArray(data.vecUnachieved) ? data.vecUnachieved : [];

          for (const item of [...highlights, ...hiddenAchieved]) {
            const apiName = item.strID;
            if (apiName && (item.bAchieved || Number(item.rtUnlocked) > 0)) {
              const existing = map.get(apiName);
              map.set(apiName, {
                achieved: 1,
                unlockTime: Number(item.rtUnlocked) || existing?.unlockTime || 0,
              });
              unachievedSet.delete(apiName);
            }
          }

          for (const item of unachievedList) {
            if (item.strID) {
              unachievedSet.add(item.strID);
            }
          }
        }
      } catch (cacheErr) {
        console.warn(`[Steam Library Cache] Erro ao ler librarycache para ${steamAppId}:`, cacheErr.message);
      }
    }

    return {
      map,
      unachievedSet,
      total: total || map.size,
      unlocked: unlocked || map.size,
    };
  } catch (err) {
    console.error("[Steam Local Achievements] Falha ao ler cache:", err.message);
    return { map: new Map(), unachievedSet: new Set(), total: 0, unlocked: 0 };
  }
}

/**
 * Decodificador de arquivos INI de emuladores (RUNE, CODEX, Tenoke, EMPRESS, etc.)
 */
function parseEmulatorIni(content) {
  const achievements = new Map();
  const lines = content.split(/\r?\n/);
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const sectionMatch = line.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();

    // Se a seção atual for o identificador da conquista (ex.: [ACH_0001], [ACH_103])
    if (
      currentSection &&
      !["Achievements", "SteamAchievements", "Settings", "Stats", "General", "DLC"].includes(currentSection)
    ) {
      const achName = currentSection;
      const existing = achievements.get(achName) || { achieved: 0, unlockTime: 0 };
      if (key.toLowerCase() === "achieved") {
        existing.achieved = val === "1" || val.toLowerCase() === "true" ? 1 : 0;
      } else if (key.toLowerCase() === "unlocktime") {
        existing.unlockTime = Number(val) || 0;
      }
      achievements.set(achName, existing);
    } else {
      // Formato em lista sob [Achievements] ou [Stats]
      if (key.toLowerCase().startsWith("ach_time_")) {
        const achName = key.slice(9);
        const existing = achievements.get(achName) || { achieved: 1, unlockTime: 0 };
        existing.unlockTime = Number(val) || 0;
        achievements.set(achName, existing);
      } else if (val === "1" || val.toLowerCase() === "true") {
        const existing = achievements.get(key) || { achieved: 1, unlockTime: 0 };
        existing.achieved = 1;
        achievements.set(key, existing);
      }
    }
  }

  return achievements;
}

/**
 * Decodificador de arquivos JSON de emuladores (Goldberg, Tenoke, etc.)
 */
function parseEmulatorJson(content) {
  const achievements = new Map();
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string") {
          achievements.set(item, { achieved: 1, unlockTime: 0 });
        } else if (item?.name || item?.id) {
          const isEarned = Boolean(item.earned || item.achieved || item.unlocked);
          achievements.set(item.name || item.id, {
            achieved: isEarned ? 1 : 0,
            unlockTime: Number(item.earned_time || item.unlock_time || item.time || 0),
          });
        }
      }
    } else if (typeof parsed === "object" && parsed !== null) {
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === "boolean") {
          achievements.set(key, { achieved: val ? 1 : 0, unlockTime: 0 });
        } else if (typeof val === "number") {
          achievements.set(key, { achieved: val > 0 ? 1 : 0, unlockTime: val > 1000000 ? val : 0 });
        } else if (typeof val === "object" && val !== null) {
          const isEarned = Boolean(val.earned || val.achieved || val.unlocked || val.earned === 1 || val.achieved === 1);
          achievements.set(key, {
            achieved: isEarned ? 1 : 0,
            unlockTime: Number(val.earned_time || val.unlock_time || val.time || 0),
          });
        }
      }
    }
  } catch (err) {
    // Silencia se formato não for JSON esperado
  }
  return achievements;
}

/**
 * Lê conquistas de emuladores locais de Steam (Goldberg, CODEX, RUNE, Tenoke, FLT, EMPRESS, etc.)
 */
function readEmulatorAchievements(steamAppId, gamePath = null) {
  const map = new Map();
  if (!steamAppId) return map;
  const appIdStr = String(steamAppId).trim();

  const candidateFiles = [];

  // 1. Diretórios públicos comuns (%PUBLIC%\Documents\Steam\<EMU>\<AppID>\...)
  const publicSteamDir = path.join(process.env.PUBLIC || "C:\\Users\\Public", "Documents", "Steam");
  if (fs.existsSync(publicSteamDir)) {
    try {
      const emuFolders = fs.readdirSync(publicSteamDir, { withFileTypes: true });
      for (const emu of emuFolders) {
        if (emu.isDirectory()) {
          const appFolder = path.join(publicSteamDir, emu.name, appIdStr);
          if (fs.existsSync(appFolder)) {
            candidateFiles.push(path.join(appFolder, "achievements.ini"));
            candidateFiles.push(path.join(appFolder, "achievements.json"));
            candidateFiles.push(path.join(appFolder, "stats.ini"));
          }
        }
      }
    } catch {}
  }

  // 2. EMPRESS
  const empressDir = path.join(
    process.env.PUBLIC || "C:\\Users\\Public",
    "Documents",
    "EMPRESS",
    appIdStr,
    "remote",
    appIdStr
  );
  if (fs.existsSync(empressDir)) {
    candidateFiles.push(path.join(empressDir, "achievements.ini"));
  }

  // 3. AppData Roaming (Goldberg, Steam/CODEX, Rune, FLT)
  const appData = process.env.APPDATA || "";
  if (appData) {
    candidateFiles.push(path.join(appData, "Goldberg SteamEmu Saves", appIdStr, "achievements.json"));
    candidateFiles.push(path.join(appData, "Goldberg SteamEmu Saves", appIdStr, "achievements.ini"));
    candidateFiles.push(path.join(appData, "Goldberg SteamEmu Saves", "settings", "achievements.json"));
    candidateFiles.push(path.join(appData, "Steam", "CODEX", appIdStr, "achievements.ini"));
    candidateFiles.push(path.join(appData, "Rune", appIdStr, "achievements.ini"));
    candidateFiles.push(path.join(appData, "RUNE", appIdStr, "achievements.ini"));
    candidateFiles.push(path.join(appData, "FLT", appIdStr, "achievements.ini"));
  }

  // 4. LocalAppData (Tenoke, FLT)
  const localAppData = process.env.LOCALAPPDATA || "";
  if (localAppData) {
    candidateFiles.push(path.join(localAppData, "Tenoke", appIdStr, "achievements.json"));
    candidateFiles.push(path.join(localAppData, "Tenoke", appIdStr, "achievements.ini"));
    candidateFiles.push(path.join(localAppData, "FLT", appIdStr, "achievements.ini"));
    candidateFiles.push(path.join(localAppData, "Steam", "CODEX", appIdStr, "achievements.ini"));
  }

  // 5. Diretório da própria instalação do jogo (se gamePath foi informado)
  if (gamePath && fs.existsSync(gamePath)) {
    try {
      const baseDir = fs.statSync(gamePath).isDirectory() ? gamePath : path.dirname(gamePath);
      const dirs = [baseDir];
      let cur = baseDir;
      for (let i = 0; i < 2; i++) {
        const parent = path.dirname(cur);
        if (parent && parent !== cur && path.dirname(parent) !== parent) {
          dirs.push(parent);
          cur = parent;
        }
      }

      for (const d of dirs) {
        candidateFiles.push(path.join(d, "steam_settings", "achievements.json"));
        candidateFiles.push(path.join(d, "steam_settings", "stats.ini"));
        candidateFiles.push(path.join(d, "achievements.json"));
        candidateFiles.push(path.join(d, "achievements.ini"));
        candidateFiles.push(path.join(d, "Profile", "Stats", "Achievements.ini"));
        candidateFiles.push(path.join(d, "SmartSteamEmu", appIdStr, "stats.ini"));
        candidateFiles.push(path.join(d, "saves", "achievements.ini"));
        candidateFiles.push(path.join(d, "saves", "achievements.json"));
      }
    } catch {}
  }

  // Processa todos os arquivos encontrados
  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "latin1");
        let parsed = new Map();
        if (filePath.endsWith(".json")) {
          parsed = parseEmulatorJson(content);
        } else {
          parsed = parseEmulatorIni(content);
        }

        for (const [k, v] of parsed) {
          const existing = map.get(k);
          if (!existing) {
            map.set(k, { ...v });
          } else {
            if (v.achieved === 1) existing.achieved = 1;
            if (v.unlockTime > 0 && (existing.unlockTime === 0 || v.unlockTime < existing.unlockTime)) {
              existing.unlockTime = v.unlockTime;
            }
          }
        }
      } catch (err) {
        console.warn(`[Emulator Achievements] Erro ao ler ${filePath}:`, err.message);
      }
    }
  }

  return map;
}

/**
 * Busca conquistas desbloqueadas de um jogador (Emuladores locais + Web API + cache local da Steam)
 */
async function fetchPlayerAchievements(steamAppId, steamId64, apiKey, localUser = null, gamePath = null) {
  // 1. Conquistas de emuladores locais (Goldberg, CODEX, RUNE, Tenoke, FLT, etc.)
  const emulatorAchievements = readEmulatorAchievements(steamAppId, gamePath);

  // 2. Conquistas do cache local da Steam oficial instalada
  const localAchievements = readLocalPlayerAchievements(
    steamAppId,
    localUser?.steamPath,
    localUser?.accountId
  );

  // 3. Conquistas da Steam Web API (se houver chave e SteamID configurados)
  let webAchievementsMap = new Map();
  let webError = null;
  let webSuccess = false;

  if (apiKey && steamId64) {
    try {
      const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${steamAppId}&key=${apiKey}&steamid=${steamId64}&l=brazilian`;
      const res = await axios.get(url, { timeout: 8000 });
      const stats = res.data?.playerstats;

      if (stats && stats.success !== false && Array.isArray(stats.achievements)) {
        webSuccess = true;
        for (const item of stats.achievements) {
          webAchievementsMap.set(item.apiname, {
            achieved: item.achieved === 1 ? 1 : 0,
            unlockTime: Number(item.unlocktime) || 0,
          });
        }
      } else if (stats && stats.error) {
        webError = stats.error;
      }
    } catch (err) {
      if (err.response?.status === 403) {
        webError = "Perfil da Steam ou detalhes de jogos estão como PRIVADOS na Steam.";
      } else {
        webError = err.response?.data?.message || err.message;
      }
    }
  }

  // Mescla dados das 3 fontes (Emulador Local, Steam Local e Web API)
  const mergedMap = new Map();

  // 1. Aplica conquistas de emuladores locais
  for (const [k, v] of emulatorAchievements) {
    if (v.achieved === 1) {
      mergedMap.set(k, { ...v });
    }
  }

  // 2. Aplica conquistas do cache local da Steam instalada
  for (const [k, v] of localAchievements.map) {
    if (v.achieved === 1) {
      mergedMap.set(k, { ...v });
    } else if (!mergedMap.has(k)) {
      mergedMap.set(k, { ...v });
    }
  }

  // 3. Aplica da Web API (se disponível)
  for (const [k, v] of webAchievementsMap) {
    if (v.achieved === 1) {
      mergedMap.set(k, { ...v });
    } else if (!mergedMap.has(k)) {
      mergedMap.set(k, { ...v });
    }
  }

  let warning = null;
  if (!webSuccess && webError) {
    if (mergedMap.size > 0) {
      warning = "Conquistas sincronizadas a partir dos saves locais.";
    } else {
      warning = webError;
    }
  }

  return {
    success: mergedMap.size > 0 || webSuccess,
    achievementsMap: mergedMap,
    unachievedSet: localAchievements.unachievedSet,
    localUnlocked: localAchievements.unlocked || emulatorAchievements.size,
    emulatorUnlocked: emulatorAchievements.size,
    error: warning,
  };
}

/**
 * Retorna as conquistas salvas no banco de dados para um jogo
 */
async function getGameAchievementsFromDb(gameId) {
  const rows = await dbAll(
    `SELECT * FROM achievements WHERE game_id = ? ORDER BY achieved DESC, unlock_time DESC, id ASC`,
    [gameId]
  );

  const total = rows.length;
  const unlocked = rows.filter((r) => r.achieved === 1).length;
  const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return {
    total,
    unlocked,
    percentage,
    achievements: rows.map((r) => ({
      id: r.id,
      gameId: r.game_id,
      steamId: r.steam_id,
      apiName: r.api_name,
      name: r.name,
      description: r.description,
      iconUrl: r.icon_url,
      iconGrayUrl: r.icon_gray_url,
      hidden: Boolean(r.hidden),
      achieved: Boolean(r.achieved),
      unlockTime: r.unlock_time,
      unlockDate: r.unlock_time > 0 ? new Date(r.unlock_time * 1000).toISOString() : null,
      updatedAt: r.updated_at,
    })),
  };
}

/**
 * Sincroniza conquistas de um jogo (jogos da Steam oficial ou locais com emuladores) com o SQLite
 */
async function syncGameAchievements(gameId, steamAppId, apiKey, customSteamId64 = null, gamePath = null) {
  if (!steamAppId) {
    throw new Error("Este jogo não possui Steam AppID associado.");
  }

  const cleanKey = apiKey ? apiKey.trim() : "";
  const localUser = detectLocalSteamUser();
  let steamId64 = customSteamId64 ? String(customSteamId64).trim() : null;

  if (!steamId64) {
    steamId64 = localUser.steamId64 || null;
  }

  // 1. Busca catálogo de conquistas do jogo
  let schema = [];
  if (cleanKey) {
    try {
      schema = await fetchGameSchema(steamAppId, cleanKey);
    } catch (schemaErr) {
      console.warn(`[Steam Schema] Falha ao obter esquema para AppID ${steamAppId}:`, schemaErr.message);
    }
  }

  // Se não foi possível obter esquema oficial e não temos nenhuma conquista prévia
  if (!schema || schema.length === 0) {
    const existing = await getGameAchievementsFromDb(gameId);
    if (existing.total > 0) {
      schema = existing.achievements.map((a) => ({
        apiName: a.apiName,
        name: a.name,
        description: a.description,
        iconUrl: a.iconUrl,
        iconGrayUrl: a.iconGrayUrl,
        hidden: a.hidden ? 1 : 0,
      }));
    } else {
      return {
        total: 0,
        unlocked: 0,
        percentage: 0,
        achievements: [],
        message: cleanKey
          ? "Este jogo não possui conquistas na Steam ou o AppID é inválido."
          : "Chave da API Steam não configurada para baixar os ícones das conquistas.",
      };
    }
  }

  // 2. Busca conquistas do jogador (Emuladores locais + Web API + cache local da Steam)
  const playerResult = await fetchPlayerAchievements(steamAppId, steamId64, cleanKey, localUser, gamePath);
  const playerMap = playerResult.achievementsMap;

  const nowIso = new Date().toISOString();

  // 3. Salva ou atualiza no banco SQLite
  let unlockedCount = Array.from(playerMap.values()).filter((v) => v.achieved === 1).length;

  for (const item of schema) {
    const playerStatus = playerMap.get(item.apiName);
    let achieved = playerStatus ? playerStatus.achieved : 0;
    let unlockTime = playerStatus ? playerStatus.unlockTime : 0;

    // Fallback do vecUnachieved da Steam oficial
    if (
      !achieved &&
      playerResult.unachievedSet &&
      playerResult.unachievedSet.size > 0 &&
      !playerResult.unachievedSet.has(item.apiName) &&
      unlockedCount < (playerResult.localUnlocked || 0)
    ) {
      achieved = 1;
      unlockTime = 0;
      unlockedCount++;
      playerMap.set(item.apiName, { achieved: 1, unlockTime: 0 });
    }

    await dbRun(
      `INSERT INTO achievements (
        game_id, steam_id, api_name, name, description,
        icon_url, icon_gray_url, hidden, achieved, unlock_time, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, api_name) DO UPDATE SET
        steam_id = excluded.steam_id,
        name = excluded.name,
        description = excluded.description,
        icon_url = excluded.icon_url,
        icon_gray_url = excluded.icon_gray_url,
        hidden = excluded.hidden,
        achieved = excluded.achieved,
        unlock_time = excluded.unlock_time,
        updated_at = excluded.updated_at`,
      [
        gameId,
        String(steamAppId),
        item.apiName,
        item.name,
        item.description,
        item.iconUrl,
        item.iconGrayUrl,
        item.hidden,
        achieved,
        unlockTime,
        nowIso,
      ]
    );
  }

  const result = await getGameAchievementsFromDb(gameId);
  if (playerResult.error) {
    result.warning = playerResult.error;
  }
  return result;
}

module.exports = {
  detectLocalSteamUser,
  testSteamApiKey,
  fetchGameSchema,
  readLocalPlayerAchievements,
  readEmulatorAchievements,
  parseEmulatorIni,
  parseEmulatorJson,
  fetchPlayerAchievements,
  getGameAchievementsFromDb,
  syncGameAchievements,
};
