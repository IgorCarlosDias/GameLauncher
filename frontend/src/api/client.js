import axios from "axios";

/**
 * Cliente HTTP único do app. Nenhum componente deve conhecer URL, porta ou token:
 * tudo passa pelos módulos de `api/` (gamesApi, systemApi, timesApi, settingsApi).
 */

const API_PORT = import.meta.env.VITE_API_PORT || "3060";
const hasLocation = typeof window !== "undefined" && Boolean(window.location?.hostname);

export const SERVER_HOST = hasLocation
  ? window.location.hostname
  : import.meta.env.VITE_SERVER_IP || "localhost";

export const API_BASE = hasLocation
  ? `${window.location.protocol}//${window.location.hostname}:${API_PORT}`
  : import.meta.env.VITE_API_URL || `http://${SERVER_HOST}:${API_PORT}`;

/**
 * Wake-on-LAN precisa partir de um dispositivo que esteja ligado (Raspberry Pi, roteador,
 * outro PC rodando o mesmo backend). Se o PC alvo estiver desligado, a API dele não responde.
 * Configure VITE_WOL_RELAY_URL para apontar para esse relay; sem ela usa a API principal.
 */
const WOL_RELAY_URL = import.meta.env.VITE_WOL_RELAY_URL || "";

let apiToken = import.meta.env.VITE_API_TOKEN || "";

export function setApiToken(token) {
  apiToken = String(token || "").trim();
}

function attachToken(config) {
  if (apiToken) {
    config.headers = config.headers || {};
    config.headers["x-api-token"] = apiToken;
  }
  return config;
}

// SettingsPage e AchievementsModal ainda usam o axios global.
axios.interceptors.request.use(attachToken);

export const http = axios.create({ baseURL: API_BASE, timeout: 12000 });
http.interceptors.request.use(attachToken);

export const wakeHttp = WOL_RELAY_URL
  ? (() => {
      const instance = axios.create({ baseURL: WOL_RELAY_URL, timeout: 8000 });
      instance.interceptors.request.use(attachToken);
      return instance;
    })()
  : http;

export const coverUrl = (file) => (file ? `${API_BASE}/covers/${file}` : null);

export function errorMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}
