import { useCallback, useEffect, useState } from "react";
import { buildWsUrl, hasAuthToken, onAuthTokenChange } from "../api";

export const WS_STATE = {
  CONNECTED: "CONNECTED",
  CONNECTING: "CONNECTING",
  DISCONNECTED: "DISCONNECTED",
};

const BASE_RECONNECT_MS = 600;
const MAX_RECONNECT_MS = 10000;
const BACKOFF_FACTOR = 1.8;
const CLIENT_PING_INTERVAL_MS = 5000;
const STALE_CONNECTION_MS = 13000;

/**
 * Gerenciador Singleton de WebSocket com Autenticação via Query Token (`/ws?token=...`),
 * Reconexão Automática (Backoff Exponencial) e multiplexação de eventos.
 */
class WebSocketClientManager {
  constructor() {
    this.ws = null;
    this.state = WS_STATE.CONNECTING;
    this.retryAttempt = 0;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.lastReceivedAt = 0;
    this.started = false;

    /** @type {Set<(state: string) => void>} */
    this.stateListeners = new Set();
    /** @type {Map<string, Set<(payload: any) => void>>} */
    this.eventListeners = new Map();

    // Cache do último evento recebido por tipo para hidratação imediata de componentes
    this.lastEventByType = new Map();

    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleOnline = this.handleOnline.bind(this);
    this.handleOffline = this.handleOffline.bind(this);
  }

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);

    // Reconecta imediatamente sempre que o token de autenticação for atualizado
    onAuthTokenChange((newToken) => {
      if (this.ws) {
        const old = this.ws;
        this.ws = null;
        try {
          old.close();
        } catch {
          // Silencioso
        }
      }
      if (newToken) {
        this.scheduleReconnect(true);
      } else {
        this.setState(WS_STATE.DISCONNECTED);
      }
    });

    this.connect();
  }

  setState(nextState) {
    if (this.state === nextState) return;
    this.state = nextState;
    for (const listener of this.stateListeners) {
      try {
        listener(nextState);
      } catch {
        // Ignora erro em listener isolado
      }
    }
  }

  connect() {
    if (typeof window === "undefined") return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (!hasAuthToken()) {
      this.setState(WS_STATE.DISCONNECTED);
      return;
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.retryAttempt === 0) {
      this.setState(WS_STATE.CONNECTING);
    }

    let socket;
    try {
      socket = new WebSocket(buildWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.retryAttempt = 0;
      this.lastReceivedAt = Date.now();
      this.setState(WS_STATE.CONNECTED);
      this.startClientHeartbeat();
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      this.lastReceivedAt = Date.now();
      if (this.state !== WS_STATE.CONNECTED) {
        this.setState(WS_STATE.CONNECTED);
      }

      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!data || typeof data !== "object") return;
      const type = String(data.type || "").toUpperCase();
      if (!type) return;

      this.lastEventByType.set(type, data);
      this.emit(type, data);
      this.emit("*", data);
    };

    socket.onerror = () => {
      // O evento onclose sempre dispara na sequência de um erro de rede
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.stopClientHeartbeat();
      this.setState(WS_STATE.DISCONNECTED);
      if (hasAuthToken()) {
        this.scheduleReconnect();
      }
    };
  }

  scheduleReconnect(immediate = false) {
    clearTimeout(this.reconnectTimer);
    if (!hasAuthToken()) {
      this.setState(WS_STATE.DISCONNECTED);
      return;
    }

    if (immediate) {
      this.retryAttempt = 0;
      this.setState(WS_STATE.CONNECTING);
      this.reconnectTimer = setTimeout(() => this.connect(), 50);
      return;
    }

    const expDelay = Math.min(
      MAX_RECONNECT_MS,
      Math.round(BASE_RECONNECT_MS * Math.pow(BACKOFF_FACTOR, this.retryAttempt))
    );
    const jitter = Math.floor(Math.random() * 220);
    const delay = Math.min(MAX_RECONNECT_MS, expDelay + jitter);

    this.retryAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!document.hidden) {
        this.connect();
      } else {
        this.scheduleReconnect(false);
      }
    }, delay);
  }

  startClientHeartbeat() {
    this.stopClientHeartbeat();
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const elapsed = Date.now() - this.lastReceivedAt;
      if (elapsed > STALE_CONNECTION_MS) {
        try {
          this.ws.close();
        } catch {
          // Silencioso
        }
        return;
      }

      if (!document.hidden) {
        this.send({ action: "PING", timestamp: Date.now() });
      }
    }, CLIENT_PING_INTERVAL_MS);
  }

  stopClientHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  handleVisibilityChange() {
    if (document.hidden || !hasAuthToken()) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.scheduleReconnect(true);
    } else {
      this.send({ action: "GET_STATE", timestamp: Date.now() });
    }
  }

  handleOnline() {
    if (hasAuthToken()) {
      this.scheduleReconnect(true);
    }
  }

  handleOffline() {
    this.setState(WS_STATE.DISCONNECTED);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Silencioso
      }
    }
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      this.ws.send(text);
      return true;
    } catch {
      return false;
    }
  }

  emit(type, payload) {
    const set = this.eventListeners.get(type);
    if (!set || set.size === 0) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch {
        // Ignora erro individual
      }
    }
  }

  subscribeState(callback) {
    this.start();
    this.stateListeners.add(callback);
    callback(this.state);
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  subscribeEvent(type, callback, { replayLast = true } = {}) {
    this.start();
    const key = String(type || "*").toUpperCase();
    if (!this.eventListeners.has(key)) {
      this.eventListeners.set(key, new Set());
    }
    const set = this.eventListeners.get(key);
    set.add(callback);

    if (replayLast && this.lastEventByType.has(key)) {
      try {
        callback(this.lastEventByType.get(key));
      } catch {
        // Silencioso
      }
    }

    return () => {
      set.delete(callback);
    };
  }

  reconnectNow() {
    this.start();
    if (!hasAuthToken()) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ action: "GET_STATE", timestamp: Date.now() });
      return;
    }
    this.scheduleReconnect(true);
  }
}

export const wsClient = new WebSocketClientManager();

/**
 * Hook React para consumir o canal WebSocket em tempo real.
 * Expõe `connectionState` ("CONNECTED" | "CONNECTING" | "DISCONNECTED"),
 * `sendMessage`, `subscribe` e `reconnect`.
 */
export function useWebSocket() {
  const [connectionState, setConnectionState] = useState(() => wsClient.state);

  useEffect(() => {
    return wsClient.subscribeState(setConnectionState);
  }, []);

  const sendMessage = useCallback((payload) => wsClient.send(payload), []);

  const subscribe = useCallback(
    (eventType, handler, options) => wsClient.subscribeEvent(eventType, handler, options),
    []
  );

  const reconnect = useCallback(() => wsClient.reconnectNow(), []);

  return {
    connectionState,
    isConnected: connectionState === WS_STATE.CONNECTED,
    isConnecting: connectionState === WS_STATE.CONNECTING,
    isDisconnected: connectionState === WS_STATE.DISCONNECTED,
    sendMessage,
    subscribe,
    reconnect,
  };
}
