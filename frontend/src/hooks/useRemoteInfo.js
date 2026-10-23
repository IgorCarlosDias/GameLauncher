import { useCallback, useEffect, useState } from "react";
import { errorMessage, systemApi } from "../api";
import { haptic } from "../lib/haptics";

const POLL_MS = 4000;

const DISPLAY_LABELS = {
  internal: "Tela do PC",
  external: "TV (segunda tela)",
  extend: "Estendida",
  clone: "Duplicada",
};

export const displayLabel = (mode) => DISPLAY_LABELS[mode] || "Detectando…";

/** Telemetria do PC (CPU/RAM/uptime) e modo de projeção; só consulta com a tela visível. */
export function useRemoteInfo({ enabled, toast }) {
  const [stats, setStats] = useState(null);
  const [displayMode, setDisplayMode] = useState(null);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([systemApi.getStats(), systemApi.getDisplay()]);
      if (s) setStats(s);
      if (d?.mode) setDisplayMode(d.mode);
    } catch {
      // Silencioso.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const id = setInterval(() => !document.hidden && refresh(), POLL_MS);
    return () => clearInterval(id);
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
