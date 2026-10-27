import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, gamesApi } from "../api";
import { haptic } from "../lib/haptics";
import { secondsSince } from "../lib/format";
import { useWebSocket } from "./useWebSocket";

function normalizeActive(res) {
  if (Array.isArray(res?.activeGames)) return res.activeGames;
  return res?.activeGame ? [res.activeGame] : [];
}

function sameIds(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (g, i) =>
        g.id === b[i].id &&
        g.startedAt === b[i].startedAt &&
        g.pid === b[i].pid
    )
  );
}

/**
 * Jogos em execução no PC: sincronização instantânea via WebSocket (ACTIVE_GAMES_UPDATE),
 * iniciar, encerrar e dispensar.
 */
export function useActiveGames({ enabled, toast, onStarted, onEnded, onChanged }) {
  const { isConnected, sendMessage, subscribe } = useWebSocket();

  const [activeGames, setActiveGames] = useState([]);
  const [launchingId, setLaunchingId] = useState(null);

  const previousRef = useRef([]);
  const initializedRef = useRef(false);
  const manualLaunchIdsRef = useRef(new Set());
  const handlersRef = useRef({ onStarted, onEnded, onChanged });

  useEffect(() => {
    handlersRef.current = { onStarted, onEnded, onChanged };
  }, [onStarted, onEnded, onChanged]);

  const fetchActiveOnce = useCallback(async () => {
    try {
      const list = normalizeActive(await gamesApi.getActive());
      setActiveGames((prev) => (sameIds(prev, list) ? prev : list));
      initializedRef.current = true;
    } catch {
      // Silencioso: o status do PC informa a conectividade
    }
  }, []);

  // Assina atualizações reativas em tempo real via WebSocket
  useEffect(() => {
    return subscribe("ACTIVE_GAMES_UPDATE", (payload) => {
      const list = normalizeActive(payload);
      setActiveGames((prev) => (sameIds(prev, list) ? prev : list));
      initializedRef.current = true;
    });
  }, [subscribe]);

  // Solicita sincronização ao habilitar ou reconectar
  useEffect(() => {
    if (!enabled) return undefined;
    if (isConnected) {
      sendMessage({ action: "GET_STATE" });
    } else {
      fetchActiveOnce();
    }
    return undefined;
  }, [enabled, isConnected, sendMessage, fetchActiveOnce]);

  // Detecta jogos iniciados externamente no PC ou encerrados (pelo app ou pelo PC)
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = activeGames;

    if (!initializedRef.current) return;

    const added = activeGames.filter((g) => !previous.some((p) => p.id === g.id));
    for (const started of added) {
      if (manualLaunchIdsRef.current.has(started.id)) {
        manualLaunchIdsRef.current.delete(started.id);
      } else if (previous.length > 0 || started.source === "auto") {
        handlersRef.current.onStarted?.(started);
      }
    }

    const removed = previous.filter((p) => !activeGames.some((g) => g.id === p.id));
    if (removed.length > 0) {
      handlersRef.current.onEnded?.(removed[0], secondsSince(removed[0].startedAt));
      handlersRef.current.onChanged?.();
    } else if (added.length > 0) {
      handlersRef.current.onChanged?.();
    }
  }, [activeGames]);

  const launch = useCallback(
    async (game) => {
      haptic(40);
      setLaunchingId(game.id);
      manualLaunchIdsRef.current.add(game.id);
      toast.show(`Iniciando ${game.name}…`, "info");
      try {
        const res = await gamesApi.play(game.id);
        if (!res?.success) {
          manualLaunchIdsRef.current.delete(game.id);
          toast.show(res?.message || "Não foi possível abrir o jogo", "error");
          return;
        }
        const entry = res.activeGame || {
          id: game.id,
          name: game.name,
          cover: game.cover,
          startedAt: new Date().toISOString(),
        };
        setActiveGames((prev) => [entry, ...prev.filter((g) => g.id !== entry.id)]);
        toast.hide();
        handlersRef.current.onStarted?.(game);
      } catch (err) {
        manualLaunchIdsRef.current.delete(game.id);
        toast.show(errorMessage(err, "Erro ao abrir jogo no computador"), "error");
      } finally {
        setLaunchingId(null);
      }
    },
    [toast]
  );

  /** `force` = taskkill; `!force` = Alt+F4. `target` = { id, exeName } opcional. */
  const close = useCallback(
    async ({ force = true, target = {} } = {}) => {
      haptic.heavy();
      const hadActive = previousRef.current.length > 0;
      toast.show(force ? "Forçando encerramento…" : "Enviando Alt+F4…", "info");
      try {
        const res = await gamesApi.close({ force, ...target });
        if (Array.isArray(res?.activeGames)) {
          setActiveGames(res.activeGames);
        } else if (target.id) {
          setActiveGames((prev) => prev.filter((g) => g.id !== target.id));
        } else {
          setActiveGames([]);
        }
        if (hadActive) toast.hide();
        else toast.show(res?.message || "Comando enviado", "success");
      } catch (err) {
        toast.show(errorMessage(err, "Falha ao encerrar jogo"), "error");
      }
    },
    [toast]
  );

  /** Remove o aviso de "jogando agora" salvando a sessão até o momento. */
  const dismiss = useCallback(async (gameId) => {
    haptic.tap();
    try {
      await gamesApi.clearActive(gameId);
    } catch {
      // Mesmo com falha de rede o aviso local é removido; o WebSocket reconcilia.
    }
    setActiveGames((prev) => (gameId ? prev.filter((g) => g.id !== gameId) : []));
  }, []);

  return { activeGames, launchingId, launch, close, dismiss, refresh: fetchActiveOnce };
}
