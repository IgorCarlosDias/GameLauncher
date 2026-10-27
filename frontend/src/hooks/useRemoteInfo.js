import { useCallback, useEffect, useState } from "react";
import { errorMessage, systemApi } from "../api";
import { haptic } from "../lib/haptics";
import { useWebSocket } from "./useWebSocket";

const DISPLAY_LABELS = {
  internal: "Tela do PC",
  external: "TV (segunda tela)",
  extend: "Estendida",
  clone: "Duplicada",
};

export const displayLabel = (mode) => DISPLAY_LABELS[mode] || "Detectando…";

/** Telemetria do PC (CPU/RAM/uptime) e modo de projeção sincronizados via WebSocket. */
export function useRemoteInfo({ enabled, toast }) {
  const { isConnected, sendMessage, subscribe } = useWebSocket();

  const [stats, setStats] = useState(null);
  const [displayMode, setDisplayMode] = useState(null);
  const [switching, setSwitching] = useState(false);

  // Recebe telemetria e modo de tela via eventos WebSocket
  useEffect(() => {
    const unsubStats = subscribe("SYSTEM_STATS_UPDATE", (payload) => {
      if (payload?.stats) setStats(payload.stats);
    });
    const unsubHb = subscribe("HEARTBEAT", (payload) => {
      if (payload?.stats) setStats(payload.stats);
    });
    const unsubDisplay = subscribe("DISPLAY_UPDATE", (payload) => {
      if (payload?.mode) setDisplayMode(payload.mode);
    });

    return () => {
      unsubStats();
      unsubHb();
      unsubDisplay();
    };
  }, [subscribe]);

  const refresh = useCallback(async () => {
    if (isConnected) {
      sendMessage({ action: "GET_STATE" });
      return;
    }
    try {
      const [s, d] = await Promise.all([systemApi.getStats(), systemApi.getDisplay()]);
      if (s) setStats(s);
      if (d?.mode) setDisplayMode(d.mode);
    } catch {
      // Silencioso.
    }
  }, [isConnected, sendMessage]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    return undefined;
  }, [enabled, refresh]);

  const switchDisplay = useCallback(
    async (mode = "toggle") => {
      haptic.confirm();
      setSwitching(true);
      try {
        const res = await systemApi.setDisplay(mode);
        if (res?.mode) setDisplayMode(res.mode);
        toast.show(`Vídeo: ${res?.label || displayLabel(res?.mode)}`, "success");
      } catch (err) {
        toast.show(errorMessage(err, "Falha ao alternar a exibição"), "error");
      } finally {
        setSwitching(false);
      }
    },
    [toast]
  );

  return { stats, displayMode, switching, switchDisplay };
}
