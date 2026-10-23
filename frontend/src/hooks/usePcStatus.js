import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, systemApi } from "../api";
import { haptic } from "../lib/haptics";

const POLL_ONLINE_MS = 6000;
const POLL_OFFLINE_MS = 4000;
const POLL_WAKING_MS = 2500;
const WAKE_TIMEOUT_MS = 90_000;
const FAILURES_BEFORE_OFFLINE = 2;

/**
 * Estado de conectividade do PC + Wake-on-LAN.
 * status:    "checking" | "online" | "offline"
 * wakeState: "idle" | "sending" | "waiting" | "success" | "error"
 */
export function usePcStatus({ toast, onOnline }) {
  const [status, setStatus] = useState("checking");
  const [info, setInfo] = useState(null);
  const [wakeState, setWakeState] = useState("idle");

  const statusRef = useRef("checking");
  const wakeStateRef = useRef("idle");
  const failuresRef = useRef(0);
  const timerRef = useRef(null);
  const onOnlineRef = useRef(onOnline);

  useEffect(() => {
    onOnlineRef.current = onOnline;
  }, [onOnline]);

  useEffect(() => {
    wakeStateRef.current = wakeState;
  }, [wakeState]);

  const applyStatus = useCallback((next) => {
    const prev = statusRef.current;
    if (prev === next) return;
    statusRef.current = next;
    setStatus(next);
    if (next === "online") onOnlineRef.current?.({ recovered: prev === "offline" });
  }, []);

  const check = useCallback(async () => {
    try {
      const data = await systemApi.ping();
      failuresRef.current = 0;
      setInfo(data);
      applyStatus("online");
    } catch {
      failuresRef.current += 1;
      if (statusRef.current === "checking" || failuresRef.current >= FAILURES_BEFORE_OFFLINE) {
        applyStatus("offline");
      }
    }
  }, [applyStatus]);

  // Polling adaptativo; pausa com a aba/PWA em segundo plano.
  useEffect(() => {
    const nextDelay = () => {
      if (wakeStateRef.current === "waiting") return POLL_WAKING_MS;
      return statusRef.current === "online" ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
    };

    const tick = async () => {
      if (!document.hidden) await check();
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(tick, nextDelay());
    };

    const onVisibility = () => {
      if (document.hidden) return;
      clearTimeout(timerRef.current);
      tick();
    };

    tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  // Resolve o fluxo de Wake-on-LAN: sucesso quando o PC responde, erro após o timeout.
  useEffect(() => {
    if (wakeState === "waiting") {
      if (status === "online") {
        setWakeState("success");
        haptic.success();
        toast.show("PC ligado e pronto!", "success");
        return undefined;
      }
      const timeout = setTimeout(() => {
        setWakeState("error");
        toast.show("O PC não respondeu. Verifique o WoL na BIOS e no Windows.", "warning");
      }, WAKE_TIMEOUT_MS);
      return () => clearTimeout(timeout);
    }

    if (wakeState === "success" || wakeState === "error") {
      const reset = setTimeout(() => setWakeState("idle"), 2600);
      return () => clearTimeout(reset);
    }
    return undefined;
  }, [wakeState, status, toast]);

  const wake = useCallback(async () => {
    const current = wakeStateRef.current;
    if (current === "sending" || current === "waiting") return;

    if (statusRef.current === "online") {
      haptic.tap();
      toast.show("O PC já está online.", "info");
      return;
    }

    haptic.confirm();
    setWakeState("sending");
    try {
      await systemApi.wake();
      setWakeState("waiting");
      toast.show("Wake-on-LAN enviado. Aguardando o PC ligar…", "info");
    } catch (err) {
      setWakeState("error");
      haptic.warn();
      toast.show(errorMessage(err, "Falha ao enviar Wake-on-LAN"), "error");
    }
  }, [toast]);

  return {
    status,
    online: status === "online",
    offline: status === "offline",
    info,
    wakeState,
    wake,
    recheck: check,
  };
}
