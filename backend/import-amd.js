const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const http = require("http");

// Carrega variáveis do .env na raiz do projeto
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = val;
    }
  }
}

async function main() {
  const amdDbPath = path.join(process.env.LOCALAPPDATA, "AMD", "CN", "RGStats.db");
  const glDbPath = path.join(__dirname, "database.sqlite");

  if (!fs.existsSync(amdDbPath)) {
    console.error("Banco de dados da AMD não encontrado em:", amdDbPath);
    process.exit(1);
  }

  const dbAMD = new sqlite3.Database(amdDbPath);
  const dbGL = new sqlite3.Database(glDbPath);

  const queryAll = (db, sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

  const glGames = await queryAll(dbGL, "SELECT * FROM games");
  const amdGames = await queryAll(dbAMD, "SELECT * FROM InstalledGames WHERE PlayTotal > 0");
  const amdSessions = await queryAll(dbAMD, "SELECT * FROM GameSessions ORDER BY Start ASC");

  const toImportGames = [];
  const toImportSessions = [];

  for (const gl of glGames) {
    const gln = (gl.name || "").toLowerCase();
    const gExe = (gl.resolved_exe || "").toLowerCase();

    // Encontrar jogos correspondentes na AMD
    const matches = amdGames.filter((amd) => {
      const at = (amd.Title || "").toLowerCase();
      const ap = (amd.ExePath || "").toLowerCase();
      const aExe = path.basename(ap).toLowerCase();

      // Ignora apps que não são jogos
      if (/(excel|winword|powerpnt|onenote|vlc|wmplayer|python|wallpaperui|amuse)/i.test(aExe)) return false;

      // Casos específicos de mapeamento
      if (gln.includes("league of legends") && (at.includes("league of legends") || ap.includes("league of legends"))) return true;
      if (gln.includes("spider-man 2") && (at.includes("spider-man 2") || ap.includes("spider-man 2"))) return true;
      if (gln.includes("onimusha") && (at.includes("onimusha") || ap.includes("onimusha"))) {
        return gl.id === 48; // shortcut principal utilizado
      }
      if (gln.includes("tekken 8") && (at.includes("tekken 8") || ap.includes("tekken 8") || aExe.includes("polaris"))) return true;
      if (gln.includes("requiem") && (at.includes("requiem") || ap.includes("requiem") || aExe.includes("re9"))) return true;
      if (gln.includes("resident evil 4") && (at.includes("re4") || ap.includes("re4") || at.includes("resident evil 4"))) return true;
      if (gln.includes("forza horizon 6") && (at.includes("forza") || ap.includes("forzahorizon6"))) return true;
      if (gln.includes("need for speed heat") && (at.includes("need for speed") || ap.includes("needforspeedheat"))) return true;
      if (gln.includes("mortal kombat 1") && (at.includes("mortal kombat 1") || aExe.includes("mk12") || ap.includes("mortal.kombat.1"))) return true;
      if (gln.includes("dead as disco") && (at.includes("dead as disco") || ap.includes("dead as disco"))) return true;
      if (gln.includes("crash bandicoot") && (at.includes("crash bandicoot") || ap.includes("crashbandicoot"))) return true;
      if (gln.includes("marvel v capcom 3") && (at.includes("marvel vs. capcom 3") || at.includes("marvel vs capcom 3") || ap.includes("ultimate marvel vs. capcom 3"))) return true;
      if (gln.includes("king of fighters xiii") && (at.includes("king of fighters xiii") || ap.includes("king of fighters xiii"))) return true;
      if (gln.includes("crimson desert") && (at.includes("crimson desert") || ap.includes("crimsondesert"))) return true;
      if (gln.includes("tony hawk") && (at.includes("tony hawk") || ap.includes("thps12"))) return true;
      if (gln.includes("zenless zone zero") && at.includes("zenless")) return true;

      if (gExe && aExe && gExe === aExe) return true;
      if (at && (gln.includes(at) || at.includes(gln))) return true;

      return false;
    });

    if (matches.length === 0) continue;

    const totalMinutes = matches.reduce((acc, m) => acc + (m.PlayTotal || 0), 0);
    const totalSec = totalMinutes * 60;
    const curSec = Number(gl.play_time) || 0;

    // Regra Math.max: só atualiza se o tempo da AMD for superior
    if (totalSec <= curSec) continue;

    const amdIds = matches.map((m) => m.GameID);
    const gameSessions = amdSessions.filter((s) => amdIds.includes(s.GameID));

    // Determina a data mais recente
    let lastPlayedIso = gl.last_played || null;
    for (const s of gameSessions) {
      if (s.End) {
        const d = new Date(s.End.replace(" ", "T"));
        if (!isNaN(d.getTime())) {
          if (!lastPlayedIso || d > new Date(lastPlayedIso)) {
            lastPlayedIso = d.toISOString();
          }
        }
      }
    }

    const newPlayCount = Math.max(gl.play_count || 0, gameSessions.length);

    toImportGames.push({
      id: gl.id,
      name: gl.name,
      path: gl.path,
      playTime: totalSec,
      playCount: newPlayCount,
      lastPlayed: lastPlayedIso,
    });

    for (const s of gameSessions) {
      if (!s.Start || !s.End) continue;
      const startD = new Date(s.Start.replace(" ", "T"));
      const endD = new Date(s.End.replace(" ", "T"));
      if (isNaN(startD.getTime()) || isNaN(endD.getTime())) continue;

      const dur = Math.round((endD.getTime() - startD.getTime()) / 1000);
      if (dur <= 0) continue;

      toImportSessions.push({
        gameId: gl.id,
        gameName: gl.name,
        gamePath: gl.path,
        startedAt: startD.toISOString(),
        endedAt: endD.toISOString(),
        duration: dur,
      });
    }

    console.log(
      `✔ ${gl.name}: ${(curSec / 3600).toFixed(1)}h -> ${(totalSec / 3600).toFixed(1)}h (+${gameSessions.length} sessões)`
    );
  }

  dbAMD.close();
  dbGL.close();

  if (toImportGames.length === 0) {
    console.log("Nenhum jogo precisa de atualização.");
    return;
  }

  const payload = JSON.stringify({
    mode: "merge",
    data: {
      games: toImportGames,
      sessions: toImportSessions,
    },
  });

  console.log(`\nEnviando importação para o GameLauncher (${toImportGames.length} jogos, ${toImportSessions.length} sessões)...`);

  const apiToken = process.env.API_TOKEN || "";

  const req = http.request(
    "http://localhost:3060/times/import",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-api-token": apiToken,
      },
    },
    (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.success) {
            console.log("\n🎉 Importação concluída com sucesso no GameLauncher!");
            console.log("Estatísticas:", parsed.stats);
          } else {
            console.error("Falha na importação:", parsed.message || body);
          }
        } catch {
          console.log("Resposta:", body);
        }
      });
    }
  );

  req.on("error", (err) => {
    console.error("Erro ao conectar à API do GameLauncher:", err.message);
  });

  req.write(payload);
  req.end();
}

main().catch(console.error);
