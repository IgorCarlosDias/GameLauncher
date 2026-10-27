import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, systemApi } from "../api";
import { haptic } from "../lib/haptics";
import { useWebSocket, WS_STATE } from "./useWebSocket";

const WAKE_RETRY_MS = 2500;
const WAKE_TIMEOUT_MS = 90_000;

/**
 * Estado de conectividade do PC em tempo real via WebSocket + Wake-on-LAN.
 * connectionState: "CONNECTED" | "CONNECTING" | "DISCONNECTED"
 * status:          "checking"  | "online"     | "offline"
 * wakeState:       "idle" | "sending" | "waiting" | "success" | "error"
 */
export function usePcStatus({ toast, onOnline }) {
  const { connectionState, subscribe, reconnect } = useWebSocket();

  const [status, setStatus] = useState("checking");
  const [info, setInfo] = useState(null);
  const [wakeState, setWakeState] = useState("idle");

  const statusRef = useRef("checking");
  const wakeStateRef = useRef("idle");
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
    if (next === "online") {
      onOnlineRef.current?.({ recovered: prev === "offline" });
    }
  }, []);

  // Sincroniza o estado do PC instantaneamente a partir do canal WebSocket
  useEffect(() => {
    if (connectionState === WS_STATE.CONNECTED) {
      applyStatus("online");
    } else if (connectionState === WS_STATE.DISCONNECTED) {
      applyStatus("offline");
    } else if (statusRef.current === "checking") {
      setStatus("checking");
    }
  }, [connectionState, applyStatus]);

  // Escuta metadados de host vindos dos eventos HOST_STATUS, HEARTBEAT e PONG
  useEffect(() => {
    const handleHostData = (payload) => {
      if (!payload) return;
      if (payload.serverIp || payload.games !== undefined) {
        setInfo((prev) => ({
          ...prev,
          status: "online",
          serverIp: payload.serverIp || prev?.serverIp,
          port: payload.port || prev?.port,
          frontendPort: payload.frontendPort || prev?.frontendPort,
          games: payload.games ?? prev?.games,
        }));
      }
      applyStatus("online");
    };

    const unsubHost = subscribe("HOST_STATUS", handleHostData);
    const unsubHb = subscribe("HEARTBEAT", handleHostData);
    const unsubPong = subscribe("PONG", handleHostData);

    return () => {
      unsubHost();
      unsubHb();
      unsubPong();
    };
  }, [subscribe, applyStatus]);

  // Durante aguardo de Wake-on-LAN, acelera tentativas de reconexão do WebSocket
  useEffect(() => {
    if (wakeState !== "waiting") return undefined;

    if (status === "online") {
      setWakeState("success");
      haptic.success();
      toast.show("PC ligado e pronto!", "success");
      return undefined;
    }

    const retryInterval = setInterval(() => {
      if (!document.hidden) reconnect();
    }, WAKE_RETRY_MS);

    const timeout = setTimeout(() => {
      setWakeState("error");
      toast.show("O PC não respondeu. Verifique o WoL na BIOS e no Windows.", "warning");
    }, WAKE_TIMEOUT_MS);

    return () => {
      clearInterval(retryInterval);
      clearTimeout(timeout);
    };
  }, [wakeState, status, reconnect, toast]);

  useEffect(() => {
    if (wakeState === "success" || wakeState === "error") {
      const reset = setTimeout(() => setWakeState("idle"), 2600);
      return () => clearTimeout(reset);
    }
    return undefined;
  }, [wakeState]);

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
    connectionState,
    online: status === "online",
    offline: status === "offline",
    info,
    wakeState,
    wake,
    recheck: reconnect,
  };
}
