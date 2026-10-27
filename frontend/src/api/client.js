import axios from "axios";

/**
 * Cliente HTTP único do app, gerenciador de Token Bearer (`gamelauncher_auth_token`)
 * e wrapper centralizado `apiFetch`.
 */

export const AUTH_TOKEN_STORAGE_KEY = "gamelauncher_auth_token";

const API_PORT = import.meta.env.VITE_API_PORT || "3060";
const hasLocation = typeof window !== "undefined" && Boolean(window.location?.hostname);

export const SERVER_HOST = hasLocation
  ? window.location.hostname
  : import.meta.env.VITE_SERVER_IP || "localhost";

export const API_BASE = hasLocation
  ? `${window.location.protocol}//${window.location.hostname}:${API_PORT}`
  : import.meta.env.VITE_API_URL || `http://${SERVER_HOST}:${API_PORT}`;

export const WS_URL = (() => {
  if (hasLocation) {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${window.location.hostname}:${API_PORT}/ws`;
  }
  return `ws://${SERVER_HOST}:${API_PORT}/ws`;
})();

export const ENV_DEFAULT_TOKEN = String(import.meta.env.VITE_API_TOKEN || "").trim();

const WOL_RELAY_URL = import.meta.env.VITE_WOL_RELAY_URL || "";

function readStoredToken() {
  if (typeof window === "undefined") return "";
  try {
    const persisted = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (persisted && persisted.trim()) return persisted.trim();
    const session = window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (session && session.trim()) return session.trim();
  } catch {
    // Storage indisponível (modo restrito)
  }
  return "";
}

let apiToken = readStoredToken();

/** @type {Set<(info: { reason: string }) => void>} */
const unauthorizedListeners = new Set();
/** @type {Set<(token: string) => void>} */
const tokenChangeListeners = new Set();

export function getApiToken() {
  return apiToken;
}

export function hasAuthToken() {
  return Boolean(apiToken && apiToken.trim());
}

export function setApiToken(token, { remember = true } = {}) {
  const clean = String(token || "").trim();
  apiToken = clean;

  if (typeof window !== "undefined") {
    try {
      if (!clean) {
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      } else if (remember) {
        window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, clean);
        window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, clean);
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      }
    } catch {
      // Ignora falha de escrita em storage privado
    }
  }

  for (const cb of tokenChangeListeners) {
    try {
      cb(clean);
    } catch {
      // Silencioso
    }
  }
}

export function onUnauthorized(callback) {
  unauthorizedListeners.add(callback);
  return () => unauthorizedListeners.delete(callback);
}

export function onAuthTokenChange(callback) {
  tokenChangeListeners.add(callback);
  return () => tokenChangeListeners.delete(callback);
}

export function notifyUnauthorized(reason = "unauthorized") {
  for (const cb of unauthorizedListeners) {
    try {
      cb({ reason });
    } catch {
      // Silencioso
    }
  }
}

export function buildWsUrl() {
  const token = getApiToken();
  return token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
}

/**
 * Função utilitária de fetch centralizada (`apiFetch`) que injeta automaticamente
 * o cabeçalho `Authorization: Bearer <TOKEN>` e trata respostas `401 Unauthorized`.
 */
export async function apiFetch(endpoint, options = {}) {
  const isFullUrl = /^https?:\/\//i.test(String(endpoint || ""));
  const url = isFullUrl
    ? endpoint
    : `${API_BASE}${String(endpoint || "").startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = new Headers(options.headers || {});
  const token = getApiToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("x-api-token", token);
  }

  let body = options.body;
  if (
    body &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer)
  ) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  });

  if (response.status === 401 && !options.skipAuthPrompt) {
    notifyUnauthorized("http_401");
  }

  return response;
}

function attachToken(config) {
  if (apiToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${apiToken}`;
    config.headers["x-api-token"] = apiToken;
  }
  return config;
}

function handleAxiosResponseError(error) {
  if (error?.response?.status === 401 && !error?.config?.skipAuthPrompt) {
    notifyUnauthorized("axios_401");
  }
  return Promise.reject(error);
}

// SettingsPage e AchievementsModal usam o axios global
axios.interceptors.request.use(attachToken);
axios.interceptors.response.use((r) => r, handleAxiosResponseError);

export const http = axios.create({ baseURL: API_BASE, timeout: 12000 });
http.interceptors.request.use(attachToken);
http.interceptors.response.use((r) => r, handleAxiosResponseError);

export const wakeHttp = WOL_RELAY_URL
  ? (() => {
      const instance = axios.create({ baseURL: WOL_RELAY_URL, timeout: 8000 });
      instance.interceptors.request.use(attachToken);
      instance.interceptors.response.use((r) => r, handleAxiosResponseError);
      return instance;
    })()
  : http;

export const coverUrl = (file) => (file ? `${API_BASE}/covers/${file}` : null);

export function errorMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}
