import { useState } from "react";
import { errorMessage, gamesApi } from "../api";

/** Busca de capas no SteamGridDB para o editor de jogo. */
export function useCoverSearch({ toast }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = async (gameId, query) => {
    const term = String(query || "").trim();
    if (!gameId || !term) return;
    setLoading(true);
    try {
      setResults(await gamesApi.searchCovers(gameId, term));
    } catch (err) {
      toast.show(errorMessage(err, "Erro ao buscar capas no SteamGridDB"), "error");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => setResults([]);

  return { results, loading, search, reset };
}
