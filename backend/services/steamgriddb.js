const axios = require("axios");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function getApiKey() {
  return (process.env.STEAMGRIDDB_KEY || "").trim();
}

async function getGameCover(gameName) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const search = await axios.get(
      `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
          Authorization: `Bearer ${apiKey}`,
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
          Authorization: `Bearer ${apiKey}`,
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
  const apiKey = getApiKey();
  if (!apiKey || !query) return [];

  try {
    const search = await axios.get(
      `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
              Authorization: `Bearer ${apiKey}`,
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

async function testSteamGridDbKey(customKey) {
  const apiKey = (customKey !== undefined ? String(customKey) : getApiKey()).trim();
  if (!apiKey) {
    return { valid: false, message: "Chave de API vazia." };
  }

  if (!/^[a-f0-9]{32}$/i.test(apiKey)) {
    return {
      valid: false,
      message: "Formato de chave inválido (a chave do SteamGridDB deve ter 32 caracteres hexadecimais).",
    };
  }

  try {
    const response = await axios.get(
      `https://www.steamgriddb.com/api/v2/search/autocomplete/portal_${Date.now()}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 8000,
      }
    );

    if (response.data?.success) {
      return {
        valid: true,
        message: "Chave SteamGridDB válida e autenticada com sucesso!",
        sampleCount: Array.isArray(response.data.data) ? response.data.data.length : 0,
      };
    }

    return {
      valid: false,
      message: "Resposta inesperada da API SteamGridDB.",
    };
  } catch (error) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return {
        valid: false,
        message: "Chave inválida ou não autorizada pelo SteamGridDB (HTTP " + status + ").",
      };
    }
    return {
      valid: false,
      message: "Erro ao conectar ao SteamGridDB: " + (error.message || "Falha desconhecida"),
    };
  }
}

module.exports = {
  getGameCover,
  searchGameCovers,
  testSteamGridDbKey,
};