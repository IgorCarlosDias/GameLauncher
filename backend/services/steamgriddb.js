const axios = require("axios");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const API_KEY = process.env.STEAMGRIDDB_KEY;

async function getGameCover(gameName) {
  if (!API_KEY) return null;

  try {
    const search = await axios.get(
      `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      }
    );

    if (!search.data?.data?.length) {
      console.log(`Sem resultado: ${gameName}`);
      return null;
    }

    const gameId = search.data.data[0].id;

    const grids = await axios.get(
      `https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      }
    );

    if (grids.data?.data?.length) {
      return grids.data.data[0].url;
    }

    // Fallback sem filtro de dimensão
    const anyGrids = await axios.get(
      `https://www.steamgriddb.com/api/v2/grids/game/${gameId}`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      }
    );

    if (!anyGrids.data?.data?.length) {
      return null;
    }

    return anyGrids.data.data[0].url;
  } catch (error) {
    console.log("Erro SteamGridDB:", error.message);
    return null;
  }
}

async function searchGameCovers(query) {
  if (!API_KEY || !query) return [];

  try {
    const search = await axios.get(
      `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      }
    );

    if (!search.data?.data?.length) {
      return [];
    }

    const topMatches = search.data.data.slice(0, 3);
    const results = [];

    for (const match of topMatches) {
      try {
        const grids = await axios.get(
          `https://www.steamgriddb.com/api/v2/grids/game/${match.id}`,
          {
            headers: {
              Authorization: `Bearer ${API_KEY}`,
            },
          }
        );

        if (grids.data?.data?.length) {
          for (const g of grids.data.data.slice(0, 8)) {
            results.push({
              id: g.id,
              url: g.url,
              thumb: g.thumb || g.url,
              gameName: match.name,
              width: g.width,
              height: g.height,
            });
          }
        }
      } catch {
        // Ignora falha individual
      }
      if (results.length >= 16) break;
    }

    return results.slice(0, 16);
  } catch (error) {
    console.log("Erro buscando galeria SteamGridDB:", error.message);
    return [];
  }
}

module.exports = {
  getGameCover,
  searchGameCovers,
};