import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, systemApi } from "../api";
import { haptic } from "../lib/haptics";
import { useWebSocket } from "./useWebSocket";

const SEND_THROTTLE_MS = 45;
const POST_COMMIT_SETTLE_MS = 350;

const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Volume mestre + dispositivos de saída sincronizados em tempo real via WebSocket.
 * Durante o arrasto do slider pelo usuário (input), bloqueia sobrescritas vindas da rede
 * para prevenir loops de feedback e jitter visual.
 */
export function useSystemAudio({ enabled, toast }) {
  const { isConnected, sendMessage, subscribe } = useWebSocket();

  const [volume, setVolumeState] = useState(50);
  const [muted, setMuted] = useState(false);
  const [devices, setDevices] = useState([]);

  const isDraggingRef = useRef(false);
  const lastCommitAtRef = useRef(0);
  const pendingRef = useRef(null);
  const timerRef = useRef(null);

  // Escuta eventos VOLUME_UPDATE em tempo real vindos do PC (teclado físico, mixer do Windows, etc.)
  useEffect(() => {
    return subscribe("VOLUME_UPDATE", (payload) => {
      if (!payload) return;

      if (Array.isArray(payload.devices) && payload.devices.length > 0) {
        setDevices(payload.devices);
      }

      // Prevenção de loop e UI jitter: nunca sobrescreve a posição enquanto o usuário arrasta o slider
      if (isDraggingRef.current) {
        return;
      }

      // Ignora pacotes residuais em trânsito logo após o término do gesto (change)
      if (
        payload.source !== "system" &&
        Date.now() - lastCommitAtRef.current < POST_COMMIT_SETTLE_MS
      ) {
        return;
      }

      const rawVol = payload.value ?? payload.volume;
      const rawMuted = payload.is_muted ?? payload.muted;

      if (typeof rawVol === "number" && Number.isFinite(rawVol)) {
        setVolumeState(clamp(rawVol));
      }
      if (typeof rawMuted === "boolean") {
        setMuted(rawMuted);
      }
    });
  }, [subscribe]);

  // Busca inicial de dispositivos de áudio caso ainda não estejam populados
  useEffect(() => {
    if (!enabled) return undefined;
    if (isConnected) {
      sendMessage({ action: "GET_STATE" });
    } else {
      systemApi
        .getAudio()
        .then((res) => {
          if (!isDraggingRef.current && typeof res?.volume === "number") {
            setVolumeState(clamp(res.volume));
          }
          if (typeof res?.muted === "boolean") setMuted(res.muted);
          if (Array.isArray(res?.devices)) setDevices(res.devices);
        })
        .catch(() => {});
    }
    return undefined;
  }, [enabled, isConnected, sendMessage]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const transmitVolume = useCallback(
    (value) => {
      const sent = sendMessage({ action: "SET_VOLUME", value });
      if (!sent) {
        systemApi.setVolume(value).catch(() => {});
      }
    },
    [sendMessage]
  );

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (pendingRef.current === null) return;
    const value = pendingRef.current;
    pendingRef.current = null;
    transmitVolume(value);
  }, [transmitVolume]);

  const startDrag = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const setLevel = useCallback(
    (raw, meta) => {
      if (meta?.dragging) {
        isDraggingRef.current = true;
      }
      const value = clamp(raw);
      setVolumeState(value);
      if (value > 0) setMuted(false);
      pendingRef.current = value;
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, SEND_THROTTLE_MS);
      }
    },
    [flush]
  );

  const commitLevel = useCallback(() => {
    isDraggingRef.current = false;
    lastCommitAtRef.current = Date.now();
    flush();
  }, [flush]);

  const toggleMute = useCallback(async () => {
    haptic.select();
    lastCommitAtRef.current = Date.now();
    setMuted((prev) => !prev);

    const sent = sendMessage({ action: "TOGGLE_MUTE" });
    if (sent) return;

    try {
      const res = await systemApi.toggleMute();
      if (typeof res?.muted === "boolean") setMuted(res.muted);
      if (typeof res?.volume === "number") setVolumeState(clamp(res.volume));
    } catch {
      setMuted((prev) => !prev);
      toast.show("Falha ao alternar o mudo", "error");
    }
  }, [sendMessage, toast]);

  const switchDevice = useCallback(
    async (device) => {
      haptic.confirm();
      // Atualização otimista imediata nos cards de dispositivo
      setDevices((prev) =>
        prev.map((d) => ({
          ...d,
          isDefault: d.id === device.id,
        }))
      );

      try {
        const res = await systemApi.setAudioDevice(device.id);
        if (res?.devices) setDevices(res.devices);
        toast.show(`Saída de áudio: ${device.name}`, "success");
      } catch (err) {
        toast.show(errorMessage(err, "Falha ao trocar saída de áudio"), "error");
      }
    },
    [toast]
  );

  return {
    volume,
    muted,
    devices,
    startDrag,
    setLevel,
    commitLevel,
    toggleMute,
    switchDevice,
  };
}
