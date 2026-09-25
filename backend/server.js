require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const axios = require("axios");

const { getGameCover } = require("./services/steamgriddb");

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

// Logger de requisições
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});


// =========================
// CONFIGURAÇÕES
// =========================

const PORT = process.env.PORT || 3000;

const GAME_FOLDER = process.env.GAME_FOLDER;

const SERVER_IP = process.env.SERVER_IP || "localhost";


const COVER_FOLDER =
  path.join(__dirname, "covers");

const SYSCONTROL_BIN =
  path.join(__dirname, "syscontrol.exe");

function runSysControl(action, param = "") {
  return new Promise((resolve, reject) => {
    exec(`"${SYSCONTROL_BIN}" ${action} ${param}`, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function findProcessPid(exeName) {
  return new Promise((resolve) => {
    if (!exeName) return resolve(null);
    exec(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const lines = stdout.trim().split("\n").filter(l => l.toLowerCase().includes(exeName.toLowerCase()));
      if (lines.length === 0) return resolve(null);
      const parts = lines[0].split(",").map(p => p.replace(/"/g, "").trim());
      const pid = parseInt(parts[1], 10);
      resolve(pid || null);
    });
  });
}


let games = [];
let activeGame = null;


// cria pasta covers

if(!fs.existsSync(COVER_FOLDER)){

  fs.mkdirSync(COVER_FOLDER);

}



// =========================
// BUSCA ARQUIVOS RECURSIVO
// =========================

function scanFolder(folder){

  let results = [];


  const items = fs.readdirSync(folder);


  items.forEach(item=>{

    const fullPath =
      path.join(folder,item);


    const stat =
      fs.statSync(fullPath);



    if(stat.isDirectory()){


      results =
        results.concat(
          scanFolder(fullPath)
        );


    }else{


      results.push(fullPath);


    }


  });



  return results;

}



// =========================
// DOWNLOAD CAPA
// =========================

async function downloadCover(gameName){


  const fileName =
    gameName
      .toLowerCase()
      .replaceAll(" ","-")
      + ".jpg";



  const filePath =
    path.join(
      COVER_FOLDER,
      fileName
    );



  if(fs.existsSync(filePath)){

    return fileName;

  }



  console.log(
    `Buscando capa: ${gameName}`
  );



  const imageUrl =
    await getGameCover(gameName);



  if(!imageUrl){

    return null;

  }



  try{


    const response =
      await axios.get(
        imageUrl,
        {
          responseType:"arraybuffer"
        }
      );



    fs.writeFileSync(
      filePath,
      response.data
    );



    console.log(
      `Capa salva: ${gameName}`
    );



    return fileName;



  }catch(error){


    console.log(
      "Erro baixando capa:",
      error.message
    );


    return null;

  }


}




// =========================
// CARREGA JOGOS
// =========================

async function loadGames(){


  games = [];



  if(!GAME_FOLDER){

    console.log(
      "GAME_FOLDER não configurado no .env"
    );

    return;

  }



  if(!fs.existsSync(GAME_FOLDER)){


    console.log(
      "Pasta de jogos não encontrada:"
    );


    console.log(
      GAME_FOLDER
    );


    return;

  }



  const files =
    scanFolder(GAME_FOLDER);



  for(const file of files){


    const ext =
      path.extname(file)
      .toLowerCase();



    if(
      ext !== ".exe" &&
      ext !== ".lnk" &&
      ext !== ".url"
    ){

      continue;

    }



    const name =
      path.basename(file,ext);



    const cover =
      await downloadCover(name);



    games.push({

      id: games.length + 1,

      name:name,

      file:file,

      extension:ext,

      cover:cover

    });


  }



  games.sort(
    (a,b)=>
      a.name.localeCompare(b.name)
  );



  console.log(
    `${games.length} jogos encontrados.`
  );


}



// =========================
// START LOAD
// =========================

loadGames();




// =========================
// ROTAS
// =========================


app.use(
  "/covers",
  express.static(COVER_FOLDER)
);



// Status

app.get("/",(req,res)=>{


  res.json({

    status:"online",

    games:games.length

  });


});




// Lista jogos
app.get("/games", (req, res) => {
  res.json(
    games.map(game => ({
      id: game.id,
      name: game.name,
      cover: game.cover,
      extension: game.extension
    }))
  );
});

// Atualizar biblioteca
app.post("/refresh", async (req, res) => {
  await loadGames();
  res.json({
    success: true,
    total: games.length
  });
});

// =========================
// ABRIR JOGO
// =========================

app.post("/play", async (req, res) => {
  const { id } = req.body;
  const game = games.find(g => g.id === id);

  if (!game) {
    return res.status(404).json({
      success: false,
      message: "Jogo não encontrado"
    });
  }

  console.log(`Abrindo: ${game.name}`);

  try {
    let exeName = null;
    let steamId = null;

    if (game.extension === ".lnk") {
      const shortcut = await resolveShortcut(game.file);
      if (shortcut && shortcut.target) {
        exeName = path.basename(shortcut.target);
      } else {
        exeName = path.basename(game.file, ".lnk") + ".exe";
      }
    } else if (game.extension === ".url") {
      try {
        const content = fs.readFileSync(game.file, "utf-8");
        const match = content.match(/steam:\/\/rungameid\/(\d+)/i);
        if (match) steamId = match[1];
      } catch {}

      exeName = path.basename(game.file, ".url") + ".exe";
    } else {
      // Executável direto (.exe)
      exeName = path.basename(game.file);
    }

    // Inicia o jogo através do Windows Desktop Shell (Shell.Application) forçando exibição na tela (SW_SHOWNORMAL)
    try {
      await runSysControl("launch", `"${game.file}"`);
    } catch (launchErr) {
      console.warn("Fallback para cmd start:", launchErr.message);
      exec(`cmd /c start "" "${game.file}"`, { cwd: path.dirname(game.file) });
    }


    activeGame = {
      id: game.id,
      name: game.name,
      file: game.file,
      extension: game.extension,
      cover: game.cover,
      pid: null,
      exeName: exeName,
      steamId: steamId,
      startedAt: new Date().toISOString()
    };

    // Tenta detectar o PID do processo nos primeiros segundos
    setTimeout(async () => {
      if (activeGame && activeGame.id === game.id && !activeGame.pid && exeName) {
        const detectedPid = await findProcessPid(exeName);
        if (detectedPid && activeGame) {
          activeGame.pid = detectedPid;
          console.log(`PID detectado para ${activeGame.name}: ${detectedPid}`);
        }
      }
    }, 1500);

    console.log(`Jogo lançado com sucesso: ${game.name} (Executável: ${exeName})`);

    res.json({
      success: true,
      game: game.name,
      activeGame
    });
  } catch (error) {
    console.error("Erro ao abrir jogo:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao abrir jogo: " + error.message
    });
  }
});

// =========================
// CONTROLE REMOTO DO SISTEMA
// =========================

// Consulta jogo em execução
app.get("/system/active-game", async (req, res) => {
  if (activeGame && !activeGame.pid && activeGame.exeName) {
    const detectedPid = await findProcessPid(activeGame.exeName);
    if (detectedPid && activeGame) {
      activeGame.pid = detectedPid;
    }
  }
  res.json({
    activeGame
  });
});


// Fechar ou encerrar jogo via taskkill
app.post("/system/close-game", async (req, res) => {
  const { force = true } = req.body || {};
  const current = activeGame;

  try {
    if (current) {
      // 1. Mata pelo PID registrado
      if (current.pid) {
        await runSysControl("killpid", current.pid);
        exec(`taskkill /F /PID ${current.pid} /T`);
      }

      // 2. Mata pelo nome do executável registrado
      if (current.exeName) {
        await runSysControl("killname", `"${current.exeName}"`);
        exec(`taskkill /F /IM "${current.exeName}" /T`);
      }
    }

    // 3. Mata processo da janela atualmente em primeiro plano
    await runSysControl("killforeground");

    // 4. Se não for forçado (modo suave), envia Alt+F4
    if (!force) {
      await runSysControl("altf4");
    }

    activeGame = null;

    res.json({
      success: true,
      message: current ? `Jogo ${current.name} encerrado via taskkill.` : "Processo encerrado com sucesso via taskkill.",
      closed: current
    });
  } catch (error) {
    console.error("Erro fechando jogo:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// Limpar estado do jogo ativo manualmente
app.post("/system/clear-active", (req, res) => {
  activeGame = null;
  res.json({ success: true });
});

// Controle de Volume do Windows
app.post("/system/volume", async (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === "up") {
      await runSysControl("volup", "3");
    } else if (action === "down") {
      await runSysControl("voldown", "3");
    } else if (action === "mute") {
      await runSysControl("volmute");
    } else {
      return res.status(400).json({ success: false, message: "Ação de volume inválida" });
    }
    res.json({ success: true, action });
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

// Teclas de Ação Rápida (Alt+Tab, Esc, Enter)
app.post("/system/key", async (req, res) => {
  const { key } = req.body || {};
  try {
    if (key === "alttab") {
      await runSysControl("alttab");
    } else if (key === "escape") {
      await runSysControl("escape");
    } else if (key === "enter") {
      await runSysControl("enter");
    } else {
      return res.status(400).json({ success: false, message: "Tecla inválida" });
    }
    res.json({ success: true, key });
  } catch (error) {
    console.error("Erro tecla:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// Controle de Energia (Suspender, Desligar, Reiniciar, Cancelar)
app.post("/system/power", (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === "sleep") {
      exec("rundll32.exe powrprof.dll,SetSuspendState 0,1,0");
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

app.listen(PORT,"0.0.0.0",()=>{


  console.clear();


  console.log(`
=================================
       GameLauncher Server
=================================

Servidor:
http://localhost:${PORT}

Rede:
http://${SERVER_IP}:${PORT}

Jogos:
${games.length}

=================================
`);


});