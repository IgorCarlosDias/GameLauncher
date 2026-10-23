import { useCallback, useState } from "react";
import { errorMessage, systemApi } from "../api";
import { haptic } from "../lib/haptics";

/** Energia do PC (suspender / desligar / reiniciar / cancelar). */
export function usePower({ toast }) {
  const [shutdownScheduled, setShutdownScheduled] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action) => {
      haptic.heavy();
      setBusy(true);
      try {
        const res = await systemApi.power(action);
        const sec = res?.timerSec || 30;
        if (action === "sleep") {
          toast.show("PC entrando em suspensão…", "info");
        } else if (action === "shutdown") {
          setShutdownScheduled(true);
          toast.show(`PC será desligado em ${sec}s`, "warning");
        } else if (action === "restart") {
          setShutdownScheduled(true);
          toast.show(`PC será reiniciado em ${sec}s`, "warning");
        } else if (action === "cancel") {
          setShutdownScheduled(false);
          toast.show("Desligamento cancelado", "success");
        }
        return true;
      } catch (err) {
        toast.show(errorMessage(err, "Falha ao executar comando de energia"), "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );

  return { shutdownScheduled, busy, run };
}
