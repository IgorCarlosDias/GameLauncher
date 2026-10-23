import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, systemApi } from "../api";
import { haptic } from "../lib/haptics";

const SEND_THROTTLE_MS = 70;
const SERVER_SYNC_PAUSE_MS = 2000;
const POLL_MS = 6000;

const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));

/** Volume mestre + dispositivos de saída. O slider atualiza na hora e a rede é throttled. */
export function useSystemAudio({ enabled, toast }) {
  const [volume, setVolumeState] = useState(50);
  const [muted, setMuted] = useState(false);
  const [devices, setDevices] = useState([]);

  const lastTouchRef = useRef(0);
  const pendingRef = useRef(null);
  const timerRef = useRef(null);

  const sync = useCallback(async () => {
    try {
      const res = await systemApi.getAudio();
      if (Date.now() - lastTouchRef.current > SERVER_SYNC_PAUSE_MS) {
        setVolumeState(clamp(res.volume ?? 50));
      }
      setMuted(Boolean(res.muted));
      setDevices(res.devices || []);
    } catch {
      // Silencioso: o indicador de status do PC cobre indisponibilidade.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    sync();
    const id = setInterval(() => !document.hidden && sync(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, sync]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (pendingRef.current === null) return;
    const value = pendingRef.current;
    pendingRef.current = null;
    systemApi.setVolume(value).catch(() => {});
  }, []);

  const setLevel = useCallback(
    (raw) => {
      const value = clamp(raw);
      lastTouchRef.current = Date.now();
      setVolumeState(value);
      setMuted(false);
      pendingRef.current = value;
      if (!timerRef.current) timerRef.current = setTimeout(flush, SEND_THROTTLE_MS);
    },
    [flush]
  );

  const toggleMute = useCallback(async () => {
    haptic.select();
    lastTouchRef.current = Date.now();
    setMuted((prev) => !prev); // otimista
    try {
      const res = await systemApi.toggleMute();
      if (typeof res?.muted === "boolean") setMuted(res.muted);
      if (typeof res?.volume === "number") setVolumeState(clamp(res.volume));
    } catch {
      setMuted((prev) => !prev);
      toast.show("Falha ao alternar o mudo", "error");
    }
  }, [toast]);

  const switchDevice = useCallback(
    async (device) => {
      haptic.confirm();
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

  return { volume, muted, devices, setLevel, commitLevel: flush, toggleMute, switchDevice };
}
