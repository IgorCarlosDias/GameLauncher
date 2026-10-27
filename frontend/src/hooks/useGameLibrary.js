import { useCallback, useState } from "react";
import { errorMessage, gamesApi } from "../api";
import { haptic } from "../lib/haptics";
import { preloadGameCovers } from "../lib/imageCache";

/** Catálogo de jogos: carga, rescan, favoritos e edição. Sem nenhum conhecimento de UI. */
export function useGameLibrary({ toast }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async ({ notify = false } = {}) => {
      try {
        setError("");
        const list = await gamesApi.list();
        setGames(list);
        preloadGameCovers(list);
        if (notify) toast.show(`Biblioteca sincronizada: ${list.length} jogos`, "success");
      } catch {
        setError("Não foi possível conectar ao servidor GameLauncher no PC.");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  const rescan = useCallback(async () => {
    haptic(30);
    setRefreshing(true);
    toast.show("Escaneando biblioteca…", "info");
    try {
      await gamesApi.rescan();
      await load({ notify: true });
    } catch {
      toast.show("Falha ao atualizar biblioteca", "error");
    } finally {
      setRefreshing(false);
    }
  }, [load, toast]);

  const toggleFavorite = useCallback(
    async (game) => {
      haptic.select();
      const setFavorite = (id, favorite) =>
        setGames((prev) => prev.map((g) => (g.id === id ? { ...g, favorite } : g)));

      setFavorite(game.id, !game.favorite); // otimista
      try {
        const res = await gamesApi.toggleFavorite(game.id);
        if (res?.success) {
          setFavorite(game.id, res.favorite);
          toast.show(res.favorite ? `${game.name} nos favoritos` : "Removido dos favoritos", "info");
        } else {
          setFavorite(game.id, game.favorite);
        }
      } catch {
        setFavorite(game.id, game.favorite);
        toast.show("Erro ao atualizar favorito", "error");
      }
    },
    [toast]
  );

  const updateGame = useCallback(
    async (id, payload) => {
      haptic.confirm();
      try {
        const res = await gamesApi.update(id, payload);
        if (!res?.success) throw new Error("update failed");
        toast.show("Jogo atualizado", "success");
        await load();
        return true;
      } catch (err) {
        toast.show(errorMessage(err, "Falha ao salvar alterações do jogo"), "error");
        return false;
      }
    },
    [load, toast]
  );

  return { games, loading, refreshing, error, load, rescan, toggleFavorite, updateGame };
}
