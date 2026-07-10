require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const axios = require("axios");

const { getGameCover } = require("./services/steamgriddb");


const app = express();

app.use(cors());
app.use(express.json());


// =========================
// CONFIGURAÇÕES
// =========================

const PORT = process.env.PORT || 3000;

const GAME_FOLDER = process.env.GAME_FOLDER;

const SERVER_IP = process.env.SERVER_IP || "localhost";


const COVER_FOLDER =
  path.join(__dirname, "covers");


let games = [];


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

app.get("/games",(req,res)=>{


  res.json(

    games.map(game=>({


      id:game.id,


      name:game.name,


      cover:game.cover


    }))

  );


});





// Atualizar biblioteca

app.post("/refresh",async(req,res)=>{


  await loadGames();


  res.json({

    success:true,

    total:games.length

  });


});





// =========================
// ABRIR JOGO
// =========================

app.post("/play",(req,res)=>{


  const {id} = req.body;



  const game =
    games.find(
      g=>g.id === id
    );



  if(!game){


    return res.status(404).json({

      success:false,

      message:"Jogo não encontrado"

    });


  }



  console.log(
    `Abrindo: ${game.name}`
  );



  try{


    if(
      game.extension === ".lnk" ||
      game.extension === ".url"
    ){


      exec(
        `cmd /c start "" "${game.file}"`
      );


    }else{


      exec(
        `"${game.file}"`
      );


    }



    res.json({

      success:true,

      game:game.name

    });



  }catch(error){


    console.log(error);


    res.status(500).json({

      success:false,

      message:"Erro ao abrir jogo"

    });


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