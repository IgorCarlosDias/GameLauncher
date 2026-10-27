const crypto = require("crypto");
const { spawn } = require("child_process");

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const HEARTBEAT_INTERVAL_MS = 5000;
const CLIENT_STALE_TIMEOUT_MS = 18000;
const ECHO_SUPPRESSION_WINDOW_MS = 650;
const MAX_FRAME_PAYLOAD_BYTES = 64 * 1024;

/**
 * Codifica uma string ou Buffer em um frame RFC 6455 (Server -> Client, sem máscara).
 * @param {number} opcode 0x1 = text, 0x8 = close, 0x9 = ping, 0xA = pong
 * @param {Buffer} payloadBuf
 */
function encodeWsFrame(opcode, payloadBuf = Buffer.alloc(0)) {
  const len = payloadBuf.length;
  let header;

  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payloadBuf]);
}

/**
 * Decodifica um ou mais frames RFC 6455 acumulados no buffer de recepção do socket.
 * Retorna os frames completos extraídos e o buffer residual.
 */
function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];

    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      const bigLen = buffer.readBigUInt64BE(offset + 2);
      if (bigLen > BigInt(MAX_FRAME_PAYLOAD_BYTES)) {
        return { frames, remaining: Buffer.alloc(0), error: "Frame payload too large" };
      }
      payloadLen = Number(bigLen);
      headerLen = 10;
    }

    if (payloadLen > MAX_FRAME_PAYLOAD_BYTES) {
      return { frames, remaining: Buffer.alloc(0), error: "Frame payload exceeded limit" };
    }

    const maskLen = isMasked ? 4 : 0;
    const totalFrameLen = headerLen + maskLen + payloadLen;

    if (offset + totalFrameLen > buffer.length) {
      // Aguarda mais bytes no próximo chunk TCP
      break;
    }

    let payload = buffer.subarray(
      offset + headerLen + maskLen,
      offset + totalFrameLen
    );

    if (isMasked) {
      const maskKey = buffer.subarray(offset + headerLen, offset + headerLen + 4);
      const unmasked = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ maskKey[i & 3];
      }
      payload = unmasked;
    }

    frames.push({ opcode, payload });
    offset += totalFrameLen;
  }

  return {
    frames,
    remaining: offset > 0 ? buffer.subarray(offset) : buffer,
    error: null,
  };
}

/**
 * Gerenciador de Conexões WebSocket (/ws) + Monitor Assíncrono de Volume e Estado do Host.
 */
class ConnectionManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.clients = new Map();
    this.heartbeatTimer = null;

    // Dependências injetadas pelo server.js
    this.sysControlBin = null;
    this.runSysControl = null;
    this.isAllowedClientIp = () => true;
    this.isAllowedOrigin = () => true;
    this.verifyToken = () => true;
    this.getHostStatusPayload = () => ({ status: "online" });
    this.getActiveGamesPayload = () => ({ activeGames: [], activeGame: null });
    this.getSystemStatsPayload = () => null;
    this.getDisplayPayload = async () => null;
    this.getVolumeStep = () => 3;

    // Estado atual de áudio sincronizado com o Windows
    this.audioState = {
      volume: 50,
      muted: false,
      devices: [],
    };

    // Controle de supressão de eco (evita loop infinito quando um cliente altera o volume)
    this.lastClientVolumeAction = {
      clientId: null,
      volume: null,
      muted: null,
      timestamp: 0,
    };

    // Processo background `syscontrol.exe watchvol`
    this.watcherProcess = null;
    this.watcherStdoutBuffer = "";
    this.watcherRestartTimer = null;
    this.stopping = false;
    this.pendingFallbackVolume = null;
    this.flushingFallbackVolume = false;
  }

  /**
   * Configura callbacks e inicia os monitores em background.
   */
  configure(options = {}) {
    this.sysControlBin = options.sysControlBin || this.sysControlBin;
    this.runSysControl = options.runSysControl || this.runSysControl;
    this.isAllowedClientIp = options.isAllowedClientIp || this.isAllowedClientIp;
    this.isAllowedOrigin = options.isAllowedOrigin || this.isAllowedOrigin;
    this.verifyToken = options.verifyToken || this.verifyToken;
    this.getHostStatusPayload = options.getHostStatusPayload || this.getHostStatusPayload;
    this.getActiveGamesPayload = options.getActiveGamesPayload || this.getActiveGamesPayload;
    this.getSystemStatsPayload = options.getSystemStatsPayload || this.getSystemStatsPayload;
    this.getDisplayPayload = options.getDisplayPayload || this.getDisplayPayload;
    this.getVolumeStep = options.getVolumeStep || this.getVolumeStep;

    this.startHeartbeat();
    this.startHostVolumeListener();
  }

  /**
   * Acopla o handler de upgrade HTTP -> WebSocket na rota `/ws`.
   */
  attachServer(httpServer) {
    httpServer.on("upgrade", (req, socket, head) => {
      try {
        const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        if (parsedUrl.pathname !== "/ws") {
          socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }

        const clientIp = req.socket?.remoteAddress || "";
        if (!this.isAllowedClientIp(clientIp)) {
          console.warn(`[WS Segurança] Conexão recusada de IP não autorizado: ${clientIp}`);
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }

        const origin = req.headers.origin;
        if (origin && !this.isAllowedOrigin(origin)) {
          console.warn(`[WS Segurança] Origem bloqueada no /ws: ${origin}`);
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }

        const queryToken = (parsedUrl.searchParams.get("token") || "").trim();
        const authHeader = String(req.headers.authorization || "");
        const bearerToken = /^Bearer\s+/i.test(authHeader)
          ? authHeader.replace(/^Bearer\s+/i, "").trim()
          : "";
        const headerToken = String(req.headers["x-api-token"] || "").trim();
        const candidateToken = queryToken || bearerToken || headerToken;

        if (!this.verifyToken(candidateToken)) {
          console.warn(`[WS Segurança] Handshake /ws rejeitado (401 Unauthorized) de IP: ${clientIp}`);
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer realm=\"GameLauncher\"\r\nConnection: close\r\n\r\n"
          );
          socket.destroy();
          return;
        }

        const wsKey = req.headers["sec-websocket-key"];
        if (!wsKey || typeof wsKey !== "string") {
          socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }

        const acceptKey = crypto
          .createHash("sha1")
          .update(wsKey.trim() + WS_MAGIC_GUID)
          .digest("base64");

        const responseHeaders = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${acceptKey}`,
          "\r\n",
        ].join("\r\n");

        socket.write(responseHeaders);
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 10000);

        this.connect(socket, req, head);
      } catch (err) {
        console.error("[WS] Erro no handshake de upgrade:", err.message);
        try {
          socket.destroy();
        } catch {}
      }
    });
  }

  /**
   * Registra uma nova conexão ativa no ConnectionManager.
   */
  connect(socket, req, initialHead) {
    const clientId = "ws_" + crypto.randomBytes(8).toString("hex");
    const client = {
      id: clientId,
      socket,
      ip: req.socket?.remoteAddress || "",
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
      buffer:
        initialHead && initialHead.length > 0
          ? Buffer.from(initialHead)
          : Buffer.alloc(0),
    };

    this.clients.set(clientId, client);

    socket.on("data", (chunk) => {
      client.lastSeenAt = Date.now();
      client.buffer =
        client.buffer.length > 0 ? Buffer.concat([client.buffer, chunk]) : chunk;

      const { frames, remaining, error } = decodeWsFrames(client.buffer);
      client.buffer = remaining;

      if (error) {
        this.disconnect(clientId, error);
        return;
      }

      for (const frame of frames) {
        this.handleFrame(client, frame);
      }
    });

    socket.on("close", () => {
      this.disconnect(clientId, "socket_close");
    });

    socket.on("end", () => {
      this.disconnect(clientId, "socket_end");
    });

    socket.on("error", () => {
      this.disconnect(clientId, "socket_error");
    });

    // Envia estado inicial completo imediatamente ao conectar
    this.sendInitialSnapshot(clientId);
  }

  /**
   * Desconecta e remove um cliente de forma limpa sem lançar exceções.
   */
  disconnect(clientId, _reason = "closed") {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);

    try {
      if (client.socket && !client.socket.destroyed) {
        client.socket.end(encodeWsFrame(0x8));
        client.socket.destroy();
      }
    } catch {}
  }

  /**
   * Envia um objeto JSON para um cliente específico.
   */
  send(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.socket || client.socket.destroyed || !client.socket.writable) {
      this.clients.delete(clientId);
      return false;
    }

    try {
      const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
      const frame = encodeWsFrame(0x1, Buffer.from(jsonStr, "utf8"));
      client.socket.write(frame);
      return true;
    } catch {
      this.disconnect(clientId, "write_error");
      return false;
    }
  }

  /**
   * Transmite (broadcast) um evento JSON para todos os clientes conectados,
   * permitindo excluir opcionalmente o cliente que originou a ação (prevenção de loop).
   */
  broadcast(payload, { excludeClientId = null } = {}) {
    if (this.clients.size === 0) return;

    let frame;
    try {
      const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
      frame = encodeWsFrame(0x1, Buffer.from(jsonStr, "utf8"));
    } catch {
      return;
    }

    for (const [clientId, client] of this.clients.entries()) {
      if (excludeClientId && clientId === excludeClientId) continue;
      if (!client.socket || client.socket.destroyed || !client.socket.writable) {
        this.clients.delete(clientId);
        continue;
      }
      try {
        client.socket.write(frame);
      } catch {
        this.disconnect(clientId, "broadcast_write_error");
      }
    }
  }

  /**
   * Processa frames brutos recebidos de um cliente.
   */
  handleFrame(client, frame) {
    switch (frame.opcode) {
      case 0x1: {
        // Frame de texto (JSON)
        const text = frame.payload.toString("utf8");
        this.handleClientMessage(client, text);
        break;
      }
      case 0x8: {
        // Close frame
        this.disconnect(client.id, "client_close");
        break;
      }
      case 0x9: {
        // Ping -> responde Pong imediatamente
        try {
          if (client.socket && !client.socket.destroyed && client.socket.writable) {
            client.socket.write(encodeWsFrame(0x0a, frame.payload));
          }
        } catch {}
        break;
      }
      case 0x0a: {
        // Pong recebido
        client.lastSeenAt = Date.now();
        break;
      }
      default:
        break;
    }
  }

  /**
   * Envia o snapshot de sincronização inicial assim que o smartphone conecta.
   */
  async sendInitialSnapshot(clientId) {
    const hostInfo = this.getHostStatusPayload();
    const gamesInfo = this.getActiveGamesPayload();
    const statsInfo = this.getSystemStatsPayload();

    this.send(clientId, {
      type: "HOST_STATUS",
      status: "online",
      timestamp: Date.now(),
      ...hostInfo,
    });

    this.send(clientId, {
      type: "VOLUME_UPDATE",
      value: this.audioState.volume,
      is_muted: this.audioState.muted,
      volume: this.audioState.volume,
      muted: this.audioState.muted,
      devices: this.audioState.devices,
      source: "initial",
    });

    this.send(clientId, {
      type: "ACTIVE_GAMES_UPDATE",
      ...gamesInfo,
    });

    if (statsInfo) {
      this.send(clientId, {
        type: "SYSTEM_STATS_UPDATE",
        stats: statsInfo,
      });
    }

    // Se a lista de dispositivos de áudio ainda estiver vazia, carrega em background sem bloquear
    if (this.audioState.devices.length === 0) {
      this.refreshAudioDevices().then((devices) => {
        if (devices && devices.length > 0 && this.clients.has(clientId)) {
          this.send(clientId, {
            type: "VOLUME_UPDATE",
            value: this.audioState.volume,
            is_muted: this.audioState.muted,
            volume: this.audioState.volume,
            muted: this.audioState.muted,
            devices: this.audioState.devices,
            source: "initial_devices",
          });
        }
      });
    }

    try {
      const display = await this.getDisplayPayload();
      if (display && this.clients.has(clientId)) {
        this.send(clientId, {
          type: "DISPLAY_UPDATE",
          ...display,
        });
      }
    } catch {}
  }

  /**
   * Trata comandos JSON enviados pelo front-end móvel via WebSocket.
   */
  async handleClientMessage(client, rawText) {
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch {
      return;
    }

    if (!msg || typeof msg !== "object") return;
    const action = String(msg.action || msg.type || "").toUpperCase().trim();

    switch (action) {
      case "PING":
      case "HEARTBEAT": {
        const hostInfo = this.getHostStatusPayload();
        this.send(client.id, {
          type: "PONG",
          status: "online",
          timestamp: Date.now(),
          clientTimestamp: msg.timestamp || null,
          ...hostInfo,
        });
        break;
      }

      case "GET_STATE":
      case "SYNC": {
        this.sendInitialSnapshot(client.id);
        break;
      }

      case "SET_VOLUME": {
        if (typeof msg.value !== "number" || !Number.isFinite(msg.value)) return;
        const clamped = Math.max(0, Math.min(100, Math.round(msg.value)));
        const nextMuted = clamped === 0 ? this.audioState.muted : false;

        this.applyVolumeFromClient(client.id, {
          mode: "set",
          value: clamped,
          muted: nextMuted,
        });
        break;
      }

      case "STEP_VOLUME": {
        const dir = String(msg.direction || "up").toLowerCase();
        const step = Math.max(1, Math.min(20, Number(msg.step) || this.getVolumeStep() || 3));
        const delta = dir === "down" ? -step : step;
        const clamped = Math.max(0, Math.min(100, Math.round(this.audioState.volume + delta)));
        const nextMuted = delta > 0 ? false : this.audioState.muted;

        this.applyVolumeFromClient(client.id, {
          mode: "set",
          value: clamped,
          muted: nextMuted,
        });
        break;
      }

      case "TOGGLE_MUTE":
      case "MUTE_TOGGLE": {
        const nextMuted = !this.audioState.muted;
        this.applyVolumeFromClient(client.id, {
          mode: "mute",
          value: this.audioState.volume,
          muted: nextMuted,
        });
        break;
      }

      case "SET_AUDIO_DEVICE": {
        const deviceId = typeof msg.deviceId === "string" ? msg.deviceId.trim() : "";
        if (!deviceId || !this.runSysControl) return;
        const currentDevices = await this.refreshAudioDevices();
        const matched = currentDevices.find((d) => d && d.id === deviceId);
        if (!matched) return;

        await this.runSysControl("setaudiodevice", matched.id);
        const updatedDevices = await this.refreshAudioDevices();
        this.broadcast({
          type: "VOLUME_UPDATE",
          value: this.audioState.volume,
          is_muted: this.audioState.muted,
          volume: this.audioState.volume,
          muted: this.audioState.muted,
          devices: updatedDevices,
          source: "device_switch",
        });
        break;
      }

      default:
        break;
    }
  }

  /**
   * Aplica alteração de volume disparada por um cliente WebSocket (ou rota HTTP)
   * sem bloquear o loop de eventos e sem gerar loop infinito de retransmissão para o emissor.
   */
  applyVolumeFromClient(originClientId, { mode = "set", value, muted }) {
    const targetVol =
      typeof value === "number"
        ? Math.max(0, Math.min(100, Math.round(value)))
        : this.audioState.volume;
    const targetMuted = typeof muted === "boolean" ? muted : this.audioState.muted;

    this.audioState.volume = targetVol;
    this.audioState.muted = targetMuted;

    // Registra janela de supressão para que o callback do Windows CoreAudio não retransmita
    // o evento de volta para quem está arrastando o slider
    this.lastClientVolumeAction = {
      clientId: originClientId || null,
      volume: targetVol,
      muted: targetMuted,
      timestamp: Date.now(),
    };

    // Envia comando diretamente ao pipe stdin do daemon `syscontrol.exe watchvol` (latência < 1ms)
    const sentToDaemon = this.sendCommandToWatcher(
      mode === "mute" ? "volmute" : `setvol ${targetVol}`
    );

    if (!sentToDaemon && this.runSysControl) {
      // Fallback assíncrono coalescido caso o processo watchvol esteja reiniciando
      if (mode === "mute") {
        this.runSysControl("volmute").catch(() => {});
      } else {
        this.pendingFallbackVolume = targetVol;
        this.flushFallbackVolume();
      }
    }

    // Transmite imediatamente para OUTROS clientes conectados (excluindo quem enviou o comando!)
    this.broadcast(
      {
        type: "VOLUME_UPDATE",
        value: this.audioState.volume,
        is_muted: this.audioState.muted,
        volume: this.audioState.volume,
        muted: this.audioState.muted,
        source: "client",
      },
      { excludeClientId: originClientId }
    );
  }

  async flushFallbackVolume() {
    if (this.flushingFallbackVolume || !this.runSysControl) return;
    this.flushingFallbackVolume = true;
    try {
      while (this.pendingFallbackVolume !== null) {
        const val = this.pendingFallbackVolume;
        this.pendingFallbackVolume = null;
        await this.runSysControl("setvol", String(val));
      }
    } catch {}
    this.flushingFallbackVolume = false;
  }

  /**
   * Escreve uma linha de comando no stdin do daemon `syscontrol.exe watchvol`.
   */
  sendCommandToWatcher(commandLine) {
    if (
      !this.watcherProcess ||
      !this.watcherProcess.stdin ||
      this.watcherProcess.killed ||
      !this.watcherProcess.stdin.writable
    ) {
      return false;
    }
    try {
      this.watcherProcess.stdin.write(`${commandLine}\n`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Inicia o listener assíncrono em background que monitora alterações de volume no Windows
   * (teclas físicas de mídia/volume, mixer do Windows, fones de ouvido).
   */
  startHostVolumeListener() {
    if (this.stopping || !this.sysControlBin) return;

    // Carrega lista inicial de dispositivos de saída sem bloquear
    this.refreshAudioDevices().catch(() => {});

    try {
      const child = spawn(this.sysControlBin, ["watchvol"], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });

      this.watcherProcess = child;
      this.watcherStdoutBuffer = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        this.watcherStdoutBuffer += chunk;
        const lines = this.watcherStdoutBuffer.split(/\r?\n/);
        this.watcherStdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("{")) continue;
          this.handleHostVolumeEvent(trimmed);
        }
      });

      child.on("error", (err) => {
        console.warn("[WS HostVolumeListener] Erro no processo watchvol:", err.message);
      });

      child.on("close", () => {
        if (this.watcherProcess === child) {
          this.watcherProcess = null;
        }
        if (!this.stopping) {
          clearTimeout(this.watcherRestartTimer);
          this.watcherRestartTimer = setTimeout(() => {
            this.startHostVolumeListener();
          }, 2000);
        }
      });
    } catch (err) {
      console.warn("[WS HostVolumeListener] Falha ao iniciar watchvol:", err.message);
    }
  }

  /**
   * Processa eventos JSON emitidos pelo listener de volume do Windows (`syscontrol.exe watchvol`).
   */
  handleHostVolumeEvent(jsonLine) {
    let evt;
    try {
      evt = JSON.parse(jsonLine);
    } catch {
      return;
    }

    if (typeof evt.volume !== "number") return;

    const newVol = Math.max(0, Math.min(100, Math.round(evt.volume)));
    const newMuted = Boolean(evt.muted ?? evt.is_muted);
    const isExternal = evt.source !== "internal";
    const deviceChanged = Boolean(evt.deviceChanged);

    const now = Date.now();
    const recentClientAction = this.lastClientVolumeAction;
    const withinSuppressionWindow =
      now - recentClientAction.timestamp < ECHO_SUPPRESSION_WINDOW_MS;

    this.audioState.volume = newVol;
    this.audioState.muted = newMuted;

    if (deviceChanged) {
      this.refreshAudioDevices().then((devices) => {
        this.broadcast({
          type: "VOLUME_UPDATE",
          value: this.audioState.volume,
          is_muted: this.audioState.muted,
          volume: this.audioState.volume,
          muted: this.audioState.muted,
          devices,
          source: "system",
        });
      });
      return;
    }

    // Se a alteração no Windows foi consequência direta do comando recém-enviado pelo cliente,
    // não retransmitimos para quem disparou (evita loop infinito e jitter no slider).
    if (!isExternal || (withinSuppressionWindow && recentClientAction.volume === newVol && recentClientAction.muted === newMuted)) {
      return;
    }

    // Alteração física/externa no PC (teclado, roda de volume, mixer do Windows):
    // transmite imediatamente para TODOS os clientes conectados!
    this.broadcast({
      type: "VOLUME_UPDATE",
      value: newVol,
      is_muted: newMuted,
      volume: newVol,
      muted: newMuted,
      source: "system",
    });
  }

  /**
   * Atualiza a lista de dispositivos de saída de áudio do Windows em background.
   */
  async refreshAudioDevices() {
    if (!this.runSysControl) return this.audioState.devices;
    try {
      const raw = await this.runSysControl("getaudiodevices");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.audioState.devices = parsed;
      }
    } catch {}
    return this.audioState.devices;
  }

  /**
   * Emite heartbeats periódicos para manter a conexão viva e sinalizar disponibilidade do host.
   */
  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (this.clients.size === 0) return;

      const now = Date.now();
      const hostInfo = this.getHostStatusPayload();
      const statsInfo = this.getSystemStatsPayload();
      const heartbeatPayload = JSON.stringify({
        type: "HEARTBEAT",
        status: "online",
        timestamp: now,
        ...hostInfo,
        stats: statsInfo || undefined,
      });

      const textFrame = encodeWsFrame(0x1, Buffer.from(heartbeatPayload, "utf8"));
      const pingFrame = encodeWsFrame(0x9, Buffer.from("hb", "utf8"));

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastSeenAt > CLIENT_STALE_TIMEOUT_MS) {
          this.disconnect(clientId, "heartbeat_timeout");
          continue;
        }
        if (!client.socket || client.socket.destroyed || !client.socket.writable) {
          this.clients.delete(clientId);
          continue;
        }
        try {
          client.socket.write(pingFrame);
          client.socket.write(textFrame);
        } catch {
          this.disconnect(clientId, "heartbeat_write_error");
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Notifica todos os clientes conectados sobre mudanças na lista de jogos ativos.
   */
  broadcastActiveGames(extra = {}) {
    if (this.clients.size === 0) return;
    const payload = this.getActiveGamesPayload();
    this.broadcast({
      type: "ACTIVE_GAMES_UPDATE",
      ...payload,
      ...extra,
    });
  }

  /**
   * Notifica todos os clientes conectados sobre mudança no modo de projeção de tela (PC / TV).
   */
  broadcastDisplayMode(displayPayload) {
    if (this.clients.size === 0 || !displayPayload) return;
    this.broadcast({
      type: "DISPLAY_UPDATE",
      ...displayPayload,
    });
  }
}

const wsManager = new ConnectionManager();

module.exports = {
  ConnectionManager,
  wsManager,
};
