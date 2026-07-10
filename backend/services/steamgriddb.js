const axios = require("axios");
const fs = require("fs");
const path = require("path");

require("dotenv").config();


const API_KEY = process.env.STEAMGRIDDB_KEY;


async function getGameCover(gameName){


    try {


        const search = await axios.get(
            `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
            {
                headers:{
                    Authorization:`Bearer ${API_KEY}`
                }
            }
        );


        if(!search.data.data.length){

            console.log(`Sem resultado: ${gameName}`);
            return null;

        }


        const gameId = search.data.data[0].id;



        const grids = await axios.get(

            `https://www.steamgriddb.com/api/v2/grids/game/${gameId}`,

            {
                headers:{
                    Authorization:`Bearer ${API_KEY}`
                }
            }

        );



        if(!grids.data.data.length){

            return null;

        }



        return grids.data.data[0].url;



    } catch(error){

        console.log(
            "Erro SteamGridDB:",
            error.message
        );

        return null;

    }


}



module.exports = {
    getGameCover
};