import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, gamesApi } from "../api";
import { haptic } from "../lib/haptics";
import { secondsSince } from "../lib/format";

const POLL_MS = 6000;

function normalizeActive(res) {
  if (Array.isArray(res?.activeGames)) return res.activeGames;
  return res?.activeGame ? [res.activeGame] : [];
}

function sameIds(a, b) {
  return a.length === b.length && a.every((g, i) => g.id === b[i].id && g.startedAt === b[i].startedAt);
}

/**
 * Jogos em execução no PC: polling, iniciar, encerrar e dispensar.
 * Os callbacks `onStarted` / `onEnded` / `onChanged` são lidos por ref (identidade livre).
 */
export function useActiveGames({ enabled, toast, onStarted, onEnded, onChanged }) {
  const [activeGames, setActiveGames] = useState([]);
  const [launchingId, setLaunchingId] = useState(null);

  const previousRef = useRef([]);
  const handlersRef = useRef({ onStarted, onEnded, onChanged });

  useEffect(() => {
    handlersRef.current = { onStarted, onEnded, onChanged };
  }, [onStarted, onEnded, onChanged]);

  const poll = useCallback(async () => {
    try {
      const list = normalizeActive(await gamesApi.getActive());
      setActiveGames((prev) => (sameIds(prev, list) ? prev : list));
    } catch {
      // Falha de polling é silenciosa; o status do PC já informa a conectividade.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    poll();
    const id = setInterval(() => {
      if (!document.hidden) poll();
    }, POLL_MS);
    const onVisible = () => !document.hidden && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, poll]);

  // Detecta jogos que saíram da lista (fechados pelo app, pelo PC ou dispensados).
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = activeGames;
    const removed = previous.filter((p) => !activeGames.some((g) => g.id === p.id));
    if (!removed.length) return;
    handlersRef.current.onEnded?.(removed[0], secondsSince(removed[0].startedAt));
    handlersRef.current.onChanged?.();
  }, [activeGames]);

  const launch = useCallback(
    async (game) => {
      haptic(40);
      setLaunchingId(game.id);
      toast.show(`Iniciando ${game.name}…`, "info");
      try {
        const res = await gamesApi.play(game.id);
        if (!res?.success) {
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
        poll();
      } catch (err) {
        toast.show(errorMessage(err, "Erro ao abrir jogo no computador"), "error");
      } finally {
        setLaunchingId(null);
      }
    },
    [poll, toast]
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
        // Com jogo ativo, a notificação de "encerrado" substitui o toast.
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
      // Mesmo com falha de rede o aviso local é removido; o próximo poll reconcilia.
    }
    setActiveGames((prev) => (gameId ? prev.filter((g) => g.id !== gameId) : []));
  }, []);

  return { activeGames, launchingId, launch, close, dismiss, refresh: poll };
}
