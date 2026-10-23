import { useCallback, useEffect, useState } from "react";
import { settingsApi } from "../api";

const DEFAULTS = {
  touchpadSensitivity: 2.1,
  shutdownTimerSec: 30,
  volumeStep: 3,
};

/** Preferências de automação configuradas no servidor (sensibilidade, timer de desligamento…). */
export function useAutomationSettings({ enabled }) {
  const [settings, setSettings] = useState(DEFAULTS);

  const reload = useCallback(async () => {
    try {
      const res = await settingsApi.get();
      const auto = res?.automation;
      if (!res?.success || !auto) return;
      setSettings({
        touchpadSensitivity: Number(auto.touchpadSensitivity) || DEFAULTS.touchpadSensitivity,
        shutdownTimerSec: Number(auto.shutdownTimerSec) || DEFAULTS.shutdownTimerSec,
        volumeStep: Number(auto.volumeStep) || DEFAULTS.volumeStep,
      });
    } catch {
      // Mantém os padrões se o servidor estiver inacessível.
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  return { ...settings, reload };
}
