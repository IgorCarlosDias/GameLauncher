import { useEffect, useState, useRef, useMemo } from "react";
import axios from "axios";

const SERVER_IP = import.meta.env.VITE_SERVER_IP;
const API_PORT = import.meta.env.VITE_API_PORT;
const API = import.meta.env.VITE_API_URL || `http://${SERVER_IP}:${API_PORT}`;
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "0.0.1";

// Haptic feedback helper for mobile touch devices
function triggerHaptic(ms = 22) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch {
      // Ignore vibration error on unsupported platforms
    }
  }
}

// Format seconds into HH:MM:SS or MM:SS (for active timer)
function formatTimer(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// Format total play time in seconds into human-readable hours/minutes
function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return null;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

// Versão para listas: nunca retorna vazio ("<1m" para sessões curtas, "0m" quando não há tempo)
function formatPlayTimeDetailed(seconds) {
  if (!seconds || seconds <= 0) return "0m";
  return formatPlayTime(seconds) || "<1m";
}

export default function App() {
  const [games, setGames] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("all"); // 'all' | 'fav' | '.exe' | '.lnk' | '.url'
  const [sortBy, setSortBy] = useState("default"); // 'default' | 'recent' | 'playtime' | 'az'
  const [viewMode, setViewMode] = useState("poster"); // 'poster' | 'list'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);

  // Active game & remote states
  const [activeGame, setActiveGame] = useState(null);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteTab, setRemoteTab] = useState("controls"); // 'controls' | 'touchpad'
  const [powerModal, setPowerModal] = useState(null); // 'sleep' | 'shutdown' | null
  const [menuOpen, setMenuOpen] = useState(false);
  const [showUnplayed, setShowUnplayed] = useState(false);
  const [shutdownScheduled, setShutdownScheduled] = useState(false);

  // System stats & audio states
  const [pcStats, setPcStats] = useState(null);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [keyboardText, setKeyboardText] = useState("");

  // Edit Game / Cover Modal states
  const [editingGame, setEditingGame] = useState(null);
  const [editName, setEditName] = useState("");
  const [coverQuery, setCoverQuery] = useState("");
  const [coverResults, setCoverResults] = useState([]);
  const [loadingCovers, setLoadingCovers] = useState(false);
  const [customCoverUrl, setCustomCoverUrl] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const toastTimerRef = useRef(null);
  const volumeTimerRef = useRef(null);
  const lastVolumeTouchRef = useRef(0);
  const touchCanvasRef = useRef(null);
  const touchStateRef = useRef({
    lastX: 0,
    lastY: 0,
    startTime: 0,
    lastTouchTime: 0,
    moved: false,
    accumX: 0,
    accumY: 0,
    sending: false,
    isTouching: false,
    mouseDown: false,
    currentLocalX: 0,
    currentLocalY: 0,
    points: [],
    ripples: [],
    animFrameId: null,
  });

  // Show quick toast notification
  const showToast = (message, type = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 2800);
  };

  // Carregar lista de jogos
  async function loadGames(showToastNotice = false) {
    try {
      setError("");
      const response = await axios.get(`${API}/games`);
      setGames(response.data);
      if (showToastNotice) {
        showToast(`Biblioteca sincronizada: ${response.data.length} jogos`, "success");
      }
    } catch (err) {
      console.error("Erro carregando jogos:", err);
      setError("Não foi possível conectar ao servidor GameLauncher no PC.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Verificar se há jogo ativo rodando
  async function checkActiveGame() {
    try {
      const response = await axios.get(`${API}/system/active-game`);
      const serverActive = response.data?.activeGame || null;
      setActiveGame((prev) => {
        if (prev && !serverActive) {
          // Jogo acabou de fechar no PC; recarrega biblioteca para atualizar tempo de jogo
          loadGames(false);
        }
        return serverActive;
      });
    } catch {
      // Ignora falha de polling silencioso
    }
  }

  // Carregar estatísticas do PC e áudio quando abrir o Controle Remoto
  async function fetchRemoteInfo() {
    try {
      const [statsRes, audioRes] = await Promise.all([
        axios.get(`${API}/system/stats`),
        axios.get(`${API}/system/audio`),
      ]);
      if (statsRes.data) setPcStats(statsRes.data);
      if (audioRes.data) {
        if (Date.now() - lastVolumeTouchRef.current > 2000) {
          setVolume(audioRes.data.volume ?? 80);
        }
        setMuted(Boolean(audioRes.data.muted));
        setAudioDevices(audioRes.data.devices || []);
      }
    } catch {
      // Ignore silent error
    }
  }

  // Atualizar biblioteca
  async function refreshGames() {
    triggerHaptic(30);
    setRefreshing(true);
    showToast("Escaneando biblioteca de jogos...", "info");
    try {
      await axios.post(`${API}/refresh`);
      await loadGames(true);
    } catch (err) {
      console.error("Erro ao atualizar:", err);
      showToast("Falha ao atualizar biblioteca", "error");
      setRefreshing(false);
    }
  }

  // Favoritar / Desfavoritar jogo
  async function toggleFavorite(e, game) {
    e.stopPropagation();
    triggerHaptic(25);
    try {
      const res = await axios.post(`${API}/games/${game.id}/favorite`);
      if (res.data.success) {
        setGames((prev) => {
          const updated = prev.map((g) =>
            g.id === game.id ? { ...g, favorite: res.data.favorite } : g
          );
          updated.sort((a, b) => {
            if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          return updated;
        });
        showToast(
          res.data.favorite ? `⭐ ${game.name} adicionado aos Favoritos` : `Removido dos Favoritos`,
          "info"
        );
      }
    } catch {
      showToast("Erro ao atualizar favorito", "error");
    }
  }

  // Abrir modal de edição de jogo / capa
  async function openEditModal(e, game) {
    e.stopPropagation();
    triggerHaptic(25);
    setEditingGame(game);
    setEditName(game.name);
    setCoverQuery(game.name);
    setCustomCoverUrl("");
    setCoverResults([]);
    searchCoversForModal(game.id, game.name);
  }

  async function searchCoversForModal(gameId, queryText) {
    if (!queryText.trim()) return;
    setLoadingCovers(true);
    try {
      const res = await axios.get(`${API}/games/${gameId}/covers`, {
        params: { query: queryText.trim() },
      });
      setCoverResults(res.data?.covers || []);
    } catch {
      showToast("Erro ao buscar capas no SteamGridDB", "error");
    } finally {
      setLoadingCovers(false);
    }
  }

  async function saveGameEdit(selectedCoverUrl = null) {
    if (!editingGame) return;
    triggerHaptic(35);
    setSavingEdit(true);
    try {
      const coverToSave = selectedCoverUrl || customCoverUrl.trim() || undefined;
      const res = await axios.put(`${API}/games/${editingGame.id}`, {
        customName: editName.trim(),
        coverUrl: coverToSave,
      });
      if (res.data?.success) {
        showToast("✅ Jogo atualizado com sucesso!", "success");
        setEditingGame(null);
        await loadGames(false);
      }
    } catch {
      showToast("Falha ao salvar alterações do jogo", "error");
    } finally {
      setSavingEdit(false);
    }
  }

  // Iniciar jogo
  async function playGame(game) {
    triggerHaptic(40);
    setLaunchingId(game.id);
    showToast(`Iniciando ${game.name}...`, "info");

    try {
      const res = await axios.post(`${API}/play`, { id: game.id });
      if (res.data.success) {
        setActiveGame(
          res.data.activeGame || {
            id: game.id,
            name: game.name,
            cover: game.cover,
            startedAt: new Date().toISOString(),
          }
        );
        setActiveSeconds(0);
        showToast(`🎮 ${game.name} iniciado no PC!`, "success");
        loadGames(false);
      }
    } catch (err) {
      console.error("Erro iniciando jogo:", err);
      showToast("Erro ao abrir jogo no computador", "error");
    } finally {
      setLaunchingId(null);
    }
  }

  // Encerrar jogo atual (soft Alt+F4 vs hard Taskkill)
  async function closeActiveGame(force = true, targetParams = {}) {
    triggerHaptic(50);
    showToast(force ? "Encerrando processo com Taskkill..." : "Enviando Alt+F4 suave ao jogo...", "info");
    try {
      const res = await axios.post(`${API}/system/close-game`, { force, ...targetParams });
      showToast(
        res.data?.message || (force ? "Jogo encerrado via Taskkill" : "Alt+F4 enviado ao PC"),
        "success"
      );
      setActiveGame(null);
      setActiveSeconds(0);
      loadGames(false);
    } catch (err) {
      console.error("Erro ao fechar:", err);
      showToast("Falha ao encerrar jogo", "error");
    }
  }

  // Dispensar barra de jogo ativo salvando a sessão
  async function dismissActiveGame() {
    triggerHaptic(20);
    try {
      await axios.post(`${API}/system/clear-active`);
    } catch {
      // ignore
    }
    setActiveGame(null);
    setActiveSeconds(0);
    loadGames(false);
  }

  // Controle de volume (+, -, mute, slider com debounce)
  async function sendVolume(action, value = undefined) {
    lastVolumeTouchRef.current = Date.now();
    if (action === "set" && typeof value === "number") {
      setVolume(value);
      setMuted(false);
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
      volumeTimerRef.current = setTimeout(() => {
        axios.post(`${API}/system/volume`, { action: "set", value }).catch(() => {});
      }, 60);
      return;
    }

    triggerHaptic(20);
    try {
      const res = await axios.post(`${API}/system/volume`, { action, value });
      if (typeof res.data?.volume === "number") setVolume(res.data.volume);
      if (typeof res.data?.muted === "boolean") setMuted(res.data.muted);
      const labels = { up: "Volume +", down: "Volume -", mute: "Mudo alternado" };
      showToast(labels[action] || "Volume ajustado", "info");
    } catch {
      showToast("Falha ao ajustar volume", "error");
    }
  }

  // Trocar dispositivo de saída de áudio (TV HDMI <-> Headset)
  async function switchAudioDevice(deviceId, deviceName) {
    triggerHaptic(35);
    try {
      const res = await axios.post(`${API}/system/audio/device`, { deviceId });
      if (res.data?.devices) {
        setAudioDevices(res.data.devices);
      }
      showToast(`🔊 Saída alterada: ${deviceName}`, "success");
    } catch {
      showToast("Falha ao trocar saída de áudio", "error");
    }
  }

  // Controle de mídia
  async function sendMedia(action) {
    triggerHaptic(25);
    try {
      await axios.post(`${API}/system/media`, { action });
      const labels = {
        play_pause: "Play / Pause",
        next: "Próxima faixa",
        prev: "Faixa anterior",
      };
      showToast(labels[action] || "Comando de mídia enviado", "info");
    } catch {
      showToast("Falha no comando de mídia", "error");
    }
  }

  // Teclas de atalho
  async function sendKey(key) {
    triggerHaptic(25);
    try {
      await axios.post(`${API}/system/key`, { key });
      const labels = {
        alttab: "Alt + Tab enviado",
        escape: "Esc enviado",
        enter: "Enter enviado",
        win: "Menu Iniciar (Win)",
        wind: "Mostrar Área de Trabalho (Win+D)",
        backspace: "Backspace",
        space: "Espaço",
        tab: "Tab",
      };
      if (labels[key]) showToast(labels[key], "info");
    } catch {
      showToast("Falha ao enviar tecla", "error");
    }
  }

  // Enviar texto digitado para o PC
  async function sendKeyboardText(e, withEnter = false) {
    if (e) e.preventDefault();
    if (!keyboardText) return;
    triggerHaptic(30);
    try {
      await axios.post(`${API}/system/keyboard`, {
        text: keyboardText,
        submitEnter: withEnter,
      });
      setKeyboardText("");
      showToast("⌨️ Texto enviado para o PC", "success");
    } catch {
      showToast("Falha ao enviar texto", "error");
    }
  }

  function flushTouchpadMove() {
    if (touchStateRef.current.sending) return;
    const sendX = Math.round(touchStateRef.current.accumX);
    const sendY = Math.round(touchStateRef.current.accumY);
    if (sendX === 0 && sendY === 0) return;

    touchStateRef.current.accumX = 0;
    touchStateRef.current.accumY = 0;
    touchStateRef.current.sending = true;

    axios
      .post(`${API}/system/mouse`, { action: "move", dx: sendX, dy: sendY })
      .catch(() => {})
      .finally(() => {
        touchStateRef.current.sending = false;
        if (Math.abs(touchStateRef.current.accumX) >= 1 || Math.abs(touchStateRef.current.accumY) >= 1) {
          flushTouchpadMove();
        }
      });
  }

  // Renderiza o rastro luminoso do dedo no canvas do Touchpad
  function startTrailAnimation() {
    if (touchStateRef.current.animFrameId) return;

    const renderFrame = () => {
      const canvas = touchCanvasRef.current;
      if (!canvas) {
        touchStateRef.current.animFrameId = null;
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const now = performance.now();
      const trailLifetime = 360; // ms que o rastro permanece visível
      const rippleLifetime = 420; // ms da onda de toque

      const state = touchStateRef.current;
      state.points = state.points.filter((p) => now - p.time < trailLifetime);
      state.ripples = state.ripples.filter((r) => now - r.time < rippleLifetime);

      // Desenhar ondas de clique/toque (ripples)
      for (const r of state.ripples) {
        const progress = (now - r.time) / rippleLifetime;
        const radius = 6 + progress * 28;
        const alpha = (1 - progress) * 0.65;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Desenhar o rastro contínuo estilo neon / cometa
      const pts = state.points;
      if (pts.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          const age = (now - curr.time) / trailLifetime;
          const life = Math.max(0, 1 - age);

          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);

          // Brilho externo ciano/índigo
          ctx.shadowColor = "rgba(59, 130, 246, 0.85)";
          ctx.shadowBlur = 12 * life;
          ctx.strokeStyle = `rgba(59, 130, 246, ${life * 0.85})`;
          ctx.lineWidth = Math.max(1.5, 9 * life);
          ctx.stroke();

          // Núcleo mais claro no centro do traço
          ctx.shadowBlur = 0;
          ctx.strokeStyle = `rgba(219, 234, 254, ${life * 0.9})`;
          ctx.lineWidth = Math.max(0.8, 3.2 * life);
          ctx.stroke();
        }
      }

      // Desenhar halo luminoso debaixo do dedo enquanto estiver pressionado
      if (state.isTouching) {
        const grad = ctx.createRadialGradient(
          state.currentLocalX,
          state.currentLocalY,
          2,
          state.currentLocalX,
          state.currentLocalY,
          20
        );
        grad.addColorStop(0, "rgba(219, 234, 254, 0.95)");
        grad.addColorStop(0.35, "rgba(59, 130, 246, 0.55)");
        grad.addColorStop(1, "rgba(139, 92, 246, 0)");

        ctx.beginPath();
        ctx.arc(state.currentLocalX, state.currentLocalY, 20, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.restore();

      if (state.isTouching || state.points.length > 0 || state.ripples.length > 0) {
        state.animFrameId = requestAnimationFrame(renderFrame);
      } else {
        state.animFrameId = null;
      }
    };

    touchStateRef.current.animFrameId = requestAnimationFrame(renderFrame);
  }

  function recordTrailPoint(clientX, clientY, addRipple = false) {
    const canvas = touchCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const now = performance.now();

    touchStateRef.current.currentLocalX = x;
    touchStateRef.current.currentLocalY = y;
    touchStateRef.current.points.push({ x, y, time: now });
    if (touchStateRef.current.points.length > 45) {
      touchStateRef.current.points.shift();
    }
    if (addRipple) {
      touchStateRef.current.ripples.push({ x, y, time: now });
    }
    startTrailAnimation();
  }

  // Touchpad Virtual handlers
  function handleTouchStart(e) {
    touchStateRef.current.lastTouchTime = Date.now();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStateRef.current.lastX = t.clientX;
      touchStateRef.current.lastY = t.clientY;
      touchStateRef.current.startTime = Date.now();
      touchStateRef.current.moved = false;
      touchStateRef.current.isTouching = true;
      recordTrailPoint(t.clientX, t.clientY, true);
    } else if (e.touches.length === 2) {
      touchStateRef.current.moved = true;
    }
  }

  function handleTouchMove(e) {
    touchStateRef.current.lastTouchTime = Date.now();
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    recordTrailPoint(t.clientX, t.clientY, false);

    const dx = (t.clientX - touchStateRef.current.lastX) * 2.1; // Sensibilidade fluida para TV
    const dy = (t.clientY - touchStateRef.current.lastY) * 2.1;
    touchStateRef.current.lastX = t.clientX;
    touchStateRef.current.lastY = t.clientY;

    if (Math.abs(dx) > 1.2 || Math.abs(dy) > 1.2) {
      touchStateRef.current.moved = true;
    }

    touchStateRef.current.accumX += dx;
    touchStateRef.current.accumY += dy;

    if (Math.abs(touchStateRef.current.accumX) >= 2 || Math.abs(touchStateRef.current.accumY) >= 2) {
      flushTouchpadMove();
    }
  }

  function handleTouchEnd() {
    touchStateRef.current.lastTouchTime = Date.now();
    touchStateRef.current.isTouching = false;
    startTrailAnimation();
    flushTouchpadMove();
    const elapsed = Date.now() - touchStateRef.current.startTime;
    if (!touchStateRef.current.moved && elapsed < 260) {
      touchStateRef.current.ripples.push({
        x: touchStateRef.current.currentLocalX,
        y: touchStateRef.current.currentLocalY,
        time: performance.now(),
      });
      startTrailAnimation();
      sendMouseClick("left");
    }
  }

  // Suporte também para arrastar com o mouse no desktop para testar o rastro
  function handleMouseDownTouchpad(e) {
    if (Date.now() - touchStateRef.current.lastTouchTime < 800) return;
    touchStateRef.current.mouseDown = true;
    touchStateRef.current.isTouching = true;
    touchStateRef.current.lastX = e.clientX;
    touchStateRef.current.lastY = e.clientY;
    touchStateRef.current.moved = false;
    recordTrailPoint(e.clientX, e.clientY, true);
  }

  function handleMouseMoveTouchpad(e) {
    if (!touchStateRef.current.mouseDown) return;
    recordTrailPoint(e.clientX, e.clientY, false);
    const dx = (e.clientX - touchStateRef.current.lastX) * 2.1;
    const dy = (e.clientY - touchStateRef.current.lastY) * 2.1;
    touchStateRef.current.lastX = e.clientX;
    touchStateRef.current.lastY = e.clientY;
    if (Math.abs(dx) > 1.2 || Math.abs(dy) > 1.2) {
      touchStateRef.current.moved = true;
    }
    touchStateRef.current.accumX += dx;
    touchStateRef.current.accumY += dy;
    if (Math.abs(touchStateRef.current.accumX) >= 2 || Math.abs(touchStateRef.current.accumY) >= 2) {
      flushTouchpadMove();
    }
  }

  function handleMouseUpTouchpad() {
    if (!touchStateRef.current.mouseDown) return;
    touchStateRef.current.mouseDown = false;
    touchStateRef.current.isTouching = false;
    startTrailAnimation();
    flushTouchpadMove();
  }

  function handleDesktopTouchpadClick(e) {
    if (Date.now() - touchStateRef.current.lastTouchTime < 800) return;
    if (touchStateRef.current.moved) return;
    recordTrailPoint(e.clientX, e.clientY, true);
    sendMouseClick("left");
  }

  async function sendMouseClick(button = "left") {
    triggerHaptic(20);
    try {
      await axios.post(`${API}/system/mouse`, { action: "click", button });
    } catch {
      // ignore
    }
  }

  async function sendMouseScroll(delta) {
    triggerHaptic(15);
    try {
      await axios.post(`${API}/system/mouse`, { action: "scroll", delta });
    } catch {
      // ignore
    }
  }

  // Gerenciamento de energia
  async function sendPower(action) {
    triggerHaptic(50);
    setPowerModal(null);
    try {
      await axios.post(`${API}/system/power`, { action });
      if (action === "sleep") {
        showToast("💤 PC entrando em modo de suspensão...", "info");
      } else if (action === "shutdown") {
        setShutdownScheduled(true);
        showToast("🛑 PC será desligado em 30 segundos!", "warning");
      } else if (action === "cancel") {
        setShutdownScheduled(false);
        showToast("✅ Desligamento cancelado!", "success");
      }
    } catch {
      showToast("Falha ao executar comando de energia", "error");
    }
  }

  // Inicialização
  useEffect(() => {
    loadGames();
    checkActiveGame();

    const interval = setInterval(checkActiveGame, 6000);
    return () => clearInterval(interval);
  }, []);

  // Atualiza status do PC quando o Controle Remoto está aberto
  useEffect(() => {
    if (!remoteOpen) return;
    fetchRemoteInfo();
    const interval = setInterval(fetchRemoteInfo, 4000);
    return () => clearInterval(interval);
  }, [remoteOpen]);

  // Timer do jogo ativo
  useEffect(() => {
    if (!activeGame) {
      setActiveSeconds(0);
      return;
    }

    if (activeGame.startedAt) {
      const diff = Math.floor((Date.now() - new Date(activeGame.startedAt).getTime()) / 1000);
      setActiveSeconds(diff > 0 ? diff : 0);
    }

    const timer = setInterval(() => {
      setActiveSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [activeGame]);

  // Menu lateral: fecha com Esc e trava o scroll do fundo enquanto aberto
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

  // Menu lateral: mostrar a biblioteca com um filtro
  function menuShowFilter(filter) {
    triggerHaptic(20);
    setMenuOpen(false);
    setRemoteOpen(false);
    setSelectedFilter(filter);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Menu lateral: abrir o Controle Remoto em uma aba
  function menuOpenRemote(tab) {
    triggerHaptic(25);
    setMenuOpen(false);
    setRemoteTab(tab);
    setRemoteOpen(true);
  }

  // Menu lateral: fechar o menu e executar uma ação do sistema
  function menuRun(action) {
    triggerHaptic(25);
    setMenuOpen(false);
    action();
  }

  // Jogos jogados recentemente (últimos 4 com lastPlayed)
  const recentGames = useMemo(() => {
    return [...games]
      .filter((g) => g.lastPlayed)
      .sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime())
      .slice(0, 6);
  }, [games]);

  // Estatísticas gerais da biblioteca do jogador
  const libraryStats = useMemo(() => {
    const totalPlayTimeSec = games.reduce((acc, g) => acc + (Number(g.playTime) || 0), 0);
    const topGame = [...games]
      .filter((g) => (g.playTime || 0) > 0 || (g.playCount || 0) > 0)
      .sort((a, b) => (b.playTime || 0) - (a.playTime || 0))[0] || null;

    return {
      totalGames: games.length,
      totalPlayTimeLabel: formatPlayTime(totalPlayTimeSec) || "0m",
      topGame,
      favCount: games.filter((g) => g.favorite).length,
    };
  }, [games]);

  // Ranking de tempo de jogo para o menu lateral (calculado apenas com o menu aberto).
  // O jogo em execução soma a sessão atual ao total acumulado.
  const playTimeRanking = useMemo(() => {
    if (!menuOpen) return { played: [], unplayed: [], totalLabel: "0m" };

    const items = games.map((g) => {
      const isActive = Boolean(activeGame && activeGame.id === g.id);
      const total = (Number(g.playTime) || 0) + (isActive ? activeSeconds : 0);
      return { id: g.id, name: g.name, cover: g.cover, total, isActive };
    });

    const played = items.filter((i) => i.total > 0).sort((a, b) => b.total - a.total);
    const unplayed = items
      .filter((i) => i.total <= 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const maxTotal = played[0]?.total || 1;
    const totalSec = played.reduce((acc, i) => acc + i.total, 0);

    return {
      played: played.map((i) => ({
        ...i,
        label: formatPlayTimeDetailed(i.total),
        percent: Math.max(3, Math.round((i.total / maxTotal) * 100)),
      })),
      unplayed,
      totalLabel: formatPlayTimeDetailed(totalSec),
    };
  }, [games, menuOpen, activeGame, activeSeconds]);

  // Jogo em Destaque (Hero Banner): Jogo ativo, ou mais recente, ou favorito, ou o primeiro
  const heroGame = useMemo(() => {
    if (activeGame) {
      const matched = games.find((g) => g.id === activeGame.id);
      if (matched) return { ...matched, isPlayingNow: true };
    }
    if (recentGames.length > 0) return recentGames[0];
    const fav = games.find((g) => g.favorite && g.cover);
    if (fav) return fav;
    const withCover = games.find((g) => g.cover);
    return withCover || games[0] || null;
  }, [activeGame, games, recentGames]);

  // Filtragem e ordenação dinâmica dos jogos
  const filteredGames = useMemo(() => {
    const result = games.filter((game) => {
      const matchesSearch = game.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      if (selectedFilter === "all") return true;
      if (selectedFilter === "fav") return Boolean(game.favorite);
      if (selectedFilter === ".exe") return game.extension === ".exe";
      if (selectedFilter === ".lnk") return game.extension === ".lnk";
      if (selectedFilter === ".url") return game.extension === ".url";
      return true;
    });

    return result.sort((a, b) => {
      if (sortBy === "recent") {
        const timeA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
        const timeB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
        return timeB - timeA;
      }
      if (sortBy === "playtime") {
        return (b.playTime || 0) - (a.playTime || 0);
      }
      if (sortBy === "az") {
        return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      }
      // default: favoritos primeiro, depois ordem alfabética
      if (a.favorite !== b.favorite) return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
      return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });
  }, [games, search, selectedFilter, sortBy]);

  // Contadores para os filtros
  const counts = useMemo(() => {
    return {
      all: games.length,
      fav: games.filter((g) => g.favorite).length,
      exe: games.filter((g) => g.extension === ".exe").length,
      lnk: games.filter((g) => g.extension === ".lnk").length,
      url: games.filter((g) => g.extension === ".url").length,
    };
  }, [games]);

  return (
    <div className="app-layout">
      {/* Toast Notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Fixo / Estilo Console */}
      <header className="navbar">
        <div className="navbar-container">
          <div className="navbar-left">
            <button
              className="menu-toggle"
              onClick={() => {
                triggerHaptic(20);
                setMenuOpen(true);
              }}
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
            >
              <span className="menu-toggle-bar"></span>
              <span className="menu-toggle-bar"></span>
              <span className="menu-toggle-bar"></span>
            </button>

            <div
              className="brand"
              onClick={() => {
                setSearch("");
                setSelectedFilter("all");
              }}
            >
              <img src="/gamepad.svg" alt="GameLauncher" className="brand-logo" />
              <div className="brand-text">
                <h1>GameLauncher</h1>
                <span className="online-badge">
                  <span className="badge-dot"></span> Online • {SERVER_IP}
                </span>
              </div>
            </div>
          </div>

          <div className="navbar-actions">
            <button
              className={`btn btn-remote ${remoteOpen ? "active" : ""}`}
              onClick={() => {
                triggerHaptic(25);
                setRemoteOpen(!remoteOpen);
              }}
              aria-label="Abrir Controle Remoto"
            >
              🕹️ <span className="btn-label">Controle</span>
            </button>

            <button
              className={`btn btn-refresh ${refreshing ? "spinning" : ""}`}
              onClick={refreshGames}
              disabled={refreshing}
              aria-label="Atualizar Biblioteca"
            >
              🔄 <span className="btn-label">Atualizar</span>
            </button>
          </div>
        </div>
      </header>

      {/* Banner Sticky: Jogando Agora */}
      {activeGame && (
        <div className="active-game-banner">
          <div className="banner-content">
            <div className="banner-game-info">
              {activeGame.cover ? (
                <img
                  src={`${API}/covers/${activeGame.cover}`}
                  alt={activeGame.name}
                  className="banner-thumb"
                />
              ) : (
                <div className="banner-thumb-placeholder">🎮</div>
              )}
              <div className="banner-titles">
                <span className="banner-tag">JOGANDO AGORA</span>
                <strong className="banner-name">{activeGame.name}</strong>
                <div className="banner-meta">
                  <span className="banner-timer">⏱️ {formatTimer(activeSeconds)}</span>
                  {activeGame.pid && (
                    <span className="banner-pid" title="Process ID">
                      PID: {activeGame.pid}
                    </span>
                  )}
                  {activeGame.exeName && <span className="banner-exe">{activeGame.exeName}</span>}
                </div>
              </div>
            </div>

            <div className="banner-buttons">
              <button
                className="btn btn-close-taskkill"
                onClick={() => closeActiveGame(true)}
                title="Encerra o processo do jogo imediatamente via Taskkill"
              >
                🛑 Encerrar (Taskkill)
              </button>
              <button
                className="btn btn-close-soft"
                onClick={() => closeActiveGame(false)}
                title="Envia apenas Alt+F4 suave para o jogo fechar salvando progresso"
              >
                ✕ Alt+F4
              </button>
              <button
                className="btn btn-dismiss"
                onClick={dismissActiveGame}
                title="Ocultar aviso se já fechou o jogo no PC"
              >
                Ocultar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shutdown Alert Floating Banner */}
      {shutdownScheduled && (
        <div className="alert-banner warning">
          <span>⚠️ PC programado para desligar em breve.</span>
          <button className="btn btn-cancel-shutdown" onClick={() => sendPower("cancel")}>
            Cancelar Desligamento
          </button>
        </div>
      )}

      <main className="container">
        {/* Hero Spotlight Banner com Ambient Blur de Console (Exibido no Início quando não está buscando) */}
        {!search && selectedFilter === "all" && heroGame && (
          <section className="hero-spotlight">
            {heroGame.cover && (
              <div
                className="hero-ambient-glow"
                style={{ backgroundImage: `url(${API}/covers/${heroGame.cover})` }}
              />
            )}
            <div className="hero-content">
              <div className="hero-poster-container">
                {heroGame.cover ? (
                  <img
                    src={`${API}/covers/${heroGame.cover}`}
                    alt={heroGame.name}
                    className="hero-poster"
                  />
                ) : (
                  <div className="hero-poster-placeholder">🎮</div>
                )}
                {heroGame.isPlayingNow && <span className="hero-badge-live">Ao Vivo</span>}
              </div>

              <div className="hero-info">
                <div className="hero-tags-row">
                  <span className={`hero-status-pill ${heroGame.isPlayingNow ? "live" : ""}`}>
                    {heroGame.isPlayingNow
                      ? "🔥 EM EXECUÇÃO NO PC"
                      : heroGame.favorite
                      ? "⭐ JOGO FAVORITO"
                      : "🏆 DESTAQUE DA BIBLIOTECA"}
                  </span>
                  <span className="hero-ext-pill">
                    {heroGame.extension === ".url" ? "Steam" : heroGame.extension === ".lnk" ? "Atalho" : "PC Game"}
                  </span>
                </div>

                <h2 className="hero-title">{heroGame.name}</h2>

                <div className="hero-stats">
                  <span className="hero-stat-item">
                    ⏱️ {formatPlayTime(heroGame.playTime) || "0h jogadas"}
                  </span>
                  {heroGame.playCount > 0 && (
                    <span className="hero-stat-item">
                      🎮 {heroGame.playCount} {heroGame.playCount === 1 ? "sessão" : "sessões"}
                    </span>
                  )}
                  {heroGame.lastPlayed && (
                    <span className="hero-stat-item dim">
                      🗓️ {new Date(heroGame.lastPlayed).toLocaleDateString("pt-BR")}
                    </span>
                  )}
                </div>

                <div className="hero-actions">
                  <button
                    className={`btn btn-hero-play ${launchingId === heroGame.id ? "launching" : ""}`}
                    onClick={() => playGame(heroGame)}
                    disabled={launchingId === heroGame.id}
                  >
                    {heroGame.isPlayingNow ? "▶ Em Jogo" : "▶ Jogar Agora"}
                  </button>

                  <button
                    className={`btn btn-hero-icon ${heroGame.favorite ? "active" : ""}`}
                    onClick={(e) => toggleFavorite(e, heroGame)}
                    title={heroGame.favorite ? "Remover dos Favoritos" : "Favoritar"}
                  >
                    {heroGame.favorite ? "★" : "☆"}
                  </button>

                  <button
                    className="btn btn-hero-icon"
                    onClick={(e) => openEditModal(e, heroGame)}
                    title="Editar capa ou nome"
                  >
                    ✏️
                  </button>

                  {heroGame.isPlayingNow && (
                    <button
                      className="btn btn-close-soft"
                      onClick={() => closeActiveGame(false)}
                      title="Fechar suavemente (Alt+F4)"
                    >
                      ✕ Alt+F4
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Gamer Profile Stats Strip */}
        {!search && selectedFilter === "all" && games.length > 0 && (
          <section className="gamer-profile-strip">
            <div className="profile-stat-card">
              <span className="profile-stat-icon">🎮</span>
              <div className="profile-stat-text">
                <strong className="profile-stat-number">{libraryStats.totalGames}</strong>
                <span className="profile-stat-sub">Jogos Instalados</span>
              </div>
            </div>

            <div className="profile-stat-card">
              <span className="profile-stat-icon">⏱️</span>
              <div className="profile-stat-text">
                <strong className="profile-stat-number">{libraryStats.totalPlayTimeLabel}</strong>
                <span className="profile-stat-sub">Tempo Total no Sofá</span>
              </div>
            </div>

            {libraryStats.topGame && (
              <div
                className="profile-stat-card clickable"
                onClick={() => playGame(libraryStats.topGame)}
                title="Clique para jogar o título mais jogado"
              >
                <span className="profile-stat-icon">👑</span>
                <div className="profile-stat-text">
                  <strong className="profile-stat-number truncate">{libraryStats.topGame.name}</strong>
                  <span className="profile-stat-sub">Mais Jogado ({formatPlayTime(libraryStats.topGame.playTime) || "1x"})</span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Barra de Pesquisa, Filtros e Opções de Exibição */}
        <section className="search-section">
          <div className="search-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="search-input"
              placeholder="Pesquisar jogos na biblioteca..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="search-clear-btn"
                onClick={() => {
                  triggerHaptic(15);
                  setSearch("");
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Filtros em Pílula + Ordenação e Alternador de Visão */}
          <div className="filters-and-controls">
            <div className="filter-pills">
              <button
                className={`pill ${selectedFilter === "all" ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic(15);
                  setSelectedFilter("all");
                }}
              >
                Todos ({counts.all})
              </button>
              {counts.fav > 0 && (
                <button
                  className={`pill pill-fav ${selectedFilter === "fav" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic(15);
                    setSelectedFilter("fav");
                  }}
                >
                  ⭐ Favoritos ({counts.fav})
                </button>
              )}
              {counts.exe > 0 && (
                <button
                  className={`pill ${selectedFilter === ".exe" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic(15);
                    setSelectedFilter(".exe");
                  }}
                >
                  Executáveis ({counts.exe})
                </button>
              )}
              {counts.lnk > 0 && (
                <button
                  className={`pill ${selectedFilter === ".lnk" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic(15);
                    setSelectedFilter(".lnk");
                  }}
                >
                  Atalhos ({counts.lnk})
                </button>
              )}
              {counts.url > 0 && (
                <button
                  className={`pill ${selectedFilter === ".url" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic(15);
                    setSelectedFilter(".url");
                  }}
                >
                  Steam / Web ({counts.url})
                </button>
              )}
            </div>

            {/* Controles de Ordenação e Grade/Lista */}
            <div className="view-controls">
              <select
                className="sort-select"
                value={sortBy}
                onChange={(e) => {
                  triggerHaptic(15);
                  setSortBy(e.target.value);
                }}
                aria-label="Ordenar biblioteca"
              >
                <option value="default">⭐ Destaques & Favoritos</option>
                <option value="recent">⏱️ Mais Recentes</option>
                <option value="playtime">🔥 Mais Jogados</option>
                <option value="az">🔤 Nome (A-Z)</option>
              </select>

              <div className="view-mode-toggle">
                <button
                  className={`view-mode-btn ${viewMode === "poster" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic(15);
                    setViewMode("poster");
                  }}
                  title="Visualização em Grade de Posters"
                  aria-label="Grade de Posters"
                >
                  ⊞
                </button>
                <button
                  className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic(15);
                    setViewMode("list");
                  }}
                  title="Visualização em Lista Compacta"
                  aria-label="Lista Compacta"
                >
                  ☰
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Seção: Continuar Jogando (Recentes em Carrossel Horizontal) */}
        {!loading && !error && !search && selectedFilter === "all" && recentGames.length > 0 && (
          <section className="recent-section">
            <div className="section-heading">
              <h3>🕹️ Continuar Jogando</h3>
              <span className="section-sub">Abertos recentemente</span>
            </div>
            <div className="recent-strip">
              {recentGames.map((game) => {
                const playTimeText = formatPlayTime(game.playTime);
                return (
                  <div
                    key={`recent-${game.id}`}
                    className="recent-card"
                    onClick={() => playGame(game)}
                  >
                    {game.cover ? (
                      <img
                        src={`${API}/covers/${game.cover}`}
                        alt={game.name}
                        className="recent-thumb"
                      />
                    ) : (
                      <div className="recent-thumb-placeholder">🎮</div>
                    )}
                    <div className="recent-meta">
                      <strong>{game.name}</strong>
                      <span>
                        {playTimeText ? `⏱️ ${playTimeText}` : `${game.playCount || 1}x jogado`}
                      </span>
                    </div>
                    <span className="recent-play-icon">▶</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Skeleton Shimmer Loading (Console Experience) */}
        {loading && (
          <div className="skeleton-grid">
            {[1, 2, 3, 4, 5, 6].map((idx) => (
              <div key={`skel-${idx}`} className="skeleton-card">
                <div className="skeleton-cover shimmer"></div>
                <div className="skeleton-title shimmer"></div>
                <div className="skeleton-btn shimmer"></div>
              </div>
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="state-feedback error-card">
            <h3>⚠️ Falha de Conexão</h3>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={() => loadGames(true)}>
              Tentar Novamente
            </button>
          </div>
        )}

        {/* Catálogo de Jogos (Posters Full-Bleed ou Lista Compacta) */}
        {!loading && !error && (
          <>
            {filteredGames.length === 0 ? (
              <div className="state-feedback">
                <p>Nenhum jogo encontrado com esse filtro.</p>
                {search && (
                  <button className="btn btn-secondary" onClick={() => setSearch("")}>
                    Limpar Pesquisa
                  </button>
                )}
              </div>
            ) : viewMode === "poster" ? (
              /* MODO GRADE: POSTERS FULL-BLEED ESTILO CONSOLE */
              <div className="grid poster-grid">
                {filteredGames.map((game) => {
                  const isLaunching = launchingId === game.id;
                  const isCurrent = activeGame && activeGame.id === game.id;
                  const playTimeLabel = formatPlayTime(game.playTime);

                  return (
                    <article
                      className={`poster-card ${isCurrent ? "current-running" : ""}`}
                      key={game.id}
                      onClick={() => playGame(game)}
                    >
                      <div className="poster-artwork-wrapper">
                        {game.cover ? (
                          <img
                            src={`${API}/covers/${game.cover}`}
                            alt={game.name}
                            loading="lazy"
                            className="poster-img"
                          />
                        ) : (
                          <div className="no-cover-poster">
                            <span className="no-cover-icon">🎮</span>
                            <span className="no-cover-text">{game.name}</span>
                          </div>
                        )}

                        {/* Degradê escuro sobreposto na parte inferior */}
                        <div className="poster-gradient-overlay" />

                        {/* Badges superiores em vidro translúcido */}
                        <div
                          className="card-overlay-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className={`card-icon-btn fav-btn ${game.favorite ? "active" : ""}`}
                            onClick={(e) => toggleFavorite(e, game)}
                            title={game.favorite ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
                          >
                            {game.favorite ? "★" : "☆"}
                          </button>
                          <button
                            className="card-icon-btn edit-btn"
                            onClick={(e) => openEditModal(e, game)}
                            title="Editar nome ou trocar capa"
                          >
                            ✏️
                          </button>
                        </div>

                        <span className={`badge-ext badge-${game.extension?.replace(".", "")}`}>
                          {game.extension === ".url"
                            ? "Steam"
                            : game.extension === ".lnk"
                            ? "Atalho"
                            : "Jogo"}
                        </span>

                        {isCurrent && <span className="badge-running-pill">Em Execução</span>}

                        {/* Conteúdo inferior integrado sobre o poster */}
                        <div className="poster-bottom-details">
                          <h3 title={game.name} className="poster-game-title">
                            {game.name}
                          </h3>

                          <div className="poster-meta-row">
                            {playTimeLabel ? (
                              <span className="poster-stat-pill">⏱️ {playTimeLabel}</span>
                            ) : (
                              <span className="poster-stat-pill dim">Não jogado</span>
                            )}
                            {game.playCount > 0 && (
                              <span className="poster-stat-pill dim">{game.playCount}x</span>
                            )}
                          </div>

                          <div
                            className="poster-btn-row"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className={`btn btn-play-poster ${isLaunching ? "launching" : ""}`}
                              onClick={() => playGame(game)}
                              disabled={isLaunching}
                            >
                              {isLaunching ? (
                                <>
                                  <span className="btn-spinner"></span> Iniciando...
                                </>
                              ) : isCurrent ? (
                                <>▶ Em Jogo</>
                              ) : (
                                <>▶ Jogar</>
                              )}
                            </button>

                            {isCurrent && (
                              <button
                                className="btn btn-card-kill-compact"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeActiveGame(true, { id: game.id, exeName: game.resolvedExe });
                                }}
                                title="Encerrar processo do jogo imediatamente"
                              >
                                🛑
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              /* MODO LISTA COMPACTA */
              <div className="list-view-container">
                {filteredGames.map((game) => {
                  const isLaunching = launchingId === game.id;
                  const isCurrent = activeGame && activeGame.id === game.id;
                  const playTimeLabel = formatPlayTime(game.playTime);

                  return (
                    <article
                      key={game.id}
                      className={`list-item-card ${isCurrent ? "current-running" : ""}`}
                      onClick={() => playGame(game)}
                    >
                      <div className="list-item-thumb-wrapper">
                        {game.cover ? (
                          <img
                            src={`${API}/covers/${game.cover}`}
                            alt={game.name}
                            className="list-item-thumb"
                            loading="lazy"
                          />
                        ) : (
                          <div className="list-item-thumb placeholder">🎮</div>
                        )}
                        {isCurrent && <span className="list-live-dot" />}
                      </div>

                      <div className="list-item-main">
                        <div className="list-item-title-row">
                          <strong className="list-item-name">{game.name}</strong>
                          <span className={`badge-ext-mini badge-${game.extension?.replace(".", "")}`}>
                            {game.extension === ".url" ? "Steam" : game.extension === ".lnk" ? "Atalho" : "Exe"}
                          </span>
                        </div>
                        <div className="list-item-meta-row">
                          <span className="list-stat">
                            {playTimeLabel ? `⏱️ ${playTimeLabel}` : "⏱️ Não jogado"}
                          </span>
                          {game.playCount > 0 && <span className="list-stat dim">• {game.playCount}x</span>}
                          {game.lastPlayed && (
                            <span className="list-stat dim">
                              • {new Date(game.lastPlayed).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="list-item-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className={`btn-list-action ${game.favorite ? "active" : ""}`}
                          onClick={(e) => toggleFavorite(e, game)}
                          title="Favoritar"
                        >
                          {game.favorite ? "★" : "☆"}
                        </button>
                        <button
                          className="btn-list-action"
                          onClick={(e) => openEditModal(e, game)}
                          title="Editar"
                        >
                          ✏️
                        </button>
                        <button
                          className={`btn btn-list-play ${isLaunching ? "launching" : ""}`}
                          onClick={() => playGame(game)}
                          disabled={isLaunching}
                        >
                          {isCurrent ? "Em Jogo" : "▶ Jogar"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Rodapé da Aplicação com Versão do Sistema */}
        <footer className="app-footer">
          <div className="app-footer-brand">
            <span className="app-footer-title">GameLauncher</span>
            <span className="app-footer-version">v{APP_VERSION}</span>
            {(window.location.port === "8070" || import.meta.env.VITE_PORT === "8070") && (
              <span className="app-footer-badge">DEV • 8070</span>
            )}
          </div>
          <p className="app-footer-meta">
            {games.length} {games.length === 1 ? "jogo na biblioteca" : "jogos na biblioteca"} • Servidor: {SERVER_IP}
          </p>
        </footer>
      </main>

      {/* Painel Drawer / Modal: Controle Remoto do PC */}
      {remoteOpen && (
        <div className="remote-overlay" onClick={() => setRemoteOpen(false)}>
          <div className="remote-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" onClick={() => setRemoteOpen(false)}></div>
            <div className="remote-header">
              <h2>🕹️ Controle Remoto do PC</h2>
              <button
                className="remote-close-btn"
                onClick={() => {
                  triggerHaptic(15);
                  setRemoteOpen(false);
                }}
              >
                ✕
              </button>
            </div>

            {/* Monitor de Desempenho do PC */}
            {pcStats && (
              <div className="pc-stats-bar">
                <div className="stat-box">
                  <span className="stat-label">CPU</span>
                  <div className="stat-progress">
                    <div
                      className="stat-progress-fill cpu"
                      style={{ width: `${pcStats.cpuPercent}%` }}
                    ></div>
                  </div>
                  <strong className="stat-val">{pcStats.cpuPercent}%</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">RAM</span>
                  <div className="stat-progress">
                    <div
                      className="stat-progress-fill ram"
                      style={{ width: `${pcStats.ramPercent}%` }}
                    ></div>
                  </div>
                  <strong className="stat-val">
                    {pcStats.ramUsedGB}/{pcStats.ramTotalGB}GB
                  </strong>
                </div>
                <div className="stat-box compact">
                  <span className="stat-label">Ativo</span>
                  <strong className="stat-val">{pcStats.uptimeHours}h</strong>
                </div>
              </div>
            )}

            {/* Abas do Controle Remoto */}
            <div className="remote-tabs">
              <button
                className={`remote-tab-btn ${remoteTab === "controls" ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic(15);
                  setRemoteTab("controls");
                }}
              >
                🎛️ Áudio & Sistema
              </button>
              <button
                className={`remote-tab-btn ${remoteTab === "touchpad" ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic(15);
                  setRemoteTab("touchpad");
                }}
              >
                🖱️ Touchpad & Teclado
              </button>
            </div>

            {remoteTab === "controls" ? (
              <div className="remote-body">
                {/* Seção Volume com Slider */}
                <div className="remote-section">
                  <div className="section-header-row">
                    <span className="section-title">🔊 Volume do Windows</span>
                    <span className="volume-badge">
                      {muted ? "🔇 Mudo" : `${volume}%`}
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => sendVolume("set", Number(e.target.value))}
                    className="volume-slider"
                  />

                  <div className="remote-button-group">
                    <button
                      className={`remote-btn ${muted ? "btn-danger-action" : ""}`}
                      onClick={() => sendVolume("mute")}
                    >
                      🔇 {muted ? "Ativar Som" : "Mudo"}
                    </button>
                    <button className="remote-btn" onClick={() => sendVolume("down")}>
                      🔉 - Volume
                    </button>
                    <button className="remote-btn" onClick={() => sendVolume("up")}>
                      🔊 + Volume
                    </button>
                  </div>
                </div>

                {/* Seletor de Saída de Áudio (TV HDMI / Headset) */}
                {audioDevices.length > 0 && (
                  <div className="remote-section">
                    <span className="section-title">📺 Saída de Áudio (TV / Headset)</span>
                    <div className="audio-devices-list">
                      {audioDevices.map((dev) => (
                        <button
                          key={dev.id}
                          className={`audio-device-btn ${dev.isDefault ? "active" : ""}`}
                          onClick={() => switchAudioDevice(dev.id, dev.name)}
                        >
                          <span className="device-icon">{dev.isDefault ? "🔊" : "🔈"}</span>
                          <span className="device-name">{dev.name}</span>
                          {dev.isDefault && <span className="device-check">Ativo</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Seção Mídia */}
                <div className="remote-section">
                  <span className="section-title">🎵 Reprodução de Mídia</span>
                  <div className="remote-button-group">
                    <button className="remote-btn" onClick={() => sendMedia("prev")}>
                      ⏮ Anterior
                    </button>
                    <button
                      className="remote-btn highlight"
                      onClick={() => sendMedia("play_pause")}
                    >
                      ⏯ Play / Pause
                    </button>
                    <button className="remote-btn" onClick={() => sendMedia("next")}>
                      ⏭ Próximo
                    </button>
                  </div>
                </div>

                {/* Seção Teclas de Atalho do Windows */}
                <div className="remote-section">
                  <span className="section-title">⌨️ Atalhos da Tela</span>
                  <div className="remote-button-group">
                    <button className="remote-btn" onClick={() => sendKey("alttab")}>
                      🗔 Alt+Tab
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("wind")}>
                      🖥️ Desktop
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("win")}>
                      ⊞ Win
                    </button>
                  </div>
                  <div className="remote-button-group two-cols">
                    <button className="remote-btn" onClick={() => sendKey("escape")}>
                      ⎋ Esc
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("enter")}>
                      ↵ Enter
                    </button>
                  </div>
                </div>

                {/* Seção Encerrar Jogo */}
                <div className="remote-section">
                  <span className="section-title">🛑 Fechar Jogo / Janela</span>
                  <div className="remote-kill-row">
                    <button
                      className="remote-btn btn-warning-action"
                      onClick={() => {
                        setRemoteOpen(false);
                        closeActiveGame(false);
                      }}
                    >
                      ✕ Fechar Suave (Alt+F4)
                    </button>
                    <button
                      className="remote-btn btn-danger-action"
                      onClick={() => {
                        setRemoteOpen(false);
                        closeActiveGame(true);
                      }}
                    >
                      🛑 Forçar Taskkill
                    </button>
                  </div>
                </div>

                {/* Seção Energia do Computador */}
                <div className="remote-section">
                  <span className="section-title">⚡ Energia do Computador</span>
                  <div className="remote-button-group two-cols">
                    <button
                      className="remote-btn btn-warning-action"
                      onClick={() => setPowerModal("sleep")}
                    >
                      💤 Suspender PC
                    </button>
                    <button
                      className="remote-btn btn-danger-action"
                      onClick={() => setPowerModal("shutdown")}
                    >
                      🛑 Desligar PC
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="remote-body">
                {/* Aba Touchpad Virtual */}
                <div className="remote-section">
                  <div className="section-header-row">
                    <span className="section-title">🖱️ Trackpad Virtual</span>
                    <span className="touchpad-hint">Arraste para mover • Toque para clicar</span>
                  </div>

                  <div
                    className="touchpad-surface"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onMouseDown={handleMouseDownTouchpad}
                    onMouseMove={handleMouseMoveTouchpad}
                    onMouseUp={handleMouseUpTouchpad}
                    onMouseLeave={handleMouseUpTouchpad}
                    onClick={handleDesktopTouchpadClick}
                  >
                    <canvas ref={touchCanvasRef} className="touchpad-canvas" />
                    <span className="touchpad-watermark">🖱️ Área de Toque da TV</span>
                  </div>

                  <div className="remote-button-group four-cols">
                    <button className="remote-btn" onClick={() => sendMouseClick("left")}>
                      🖱️ Esq.
                    </button>
                    <button className="remote-btn" onClick={() => sendMouseClick("double")}>
                      ⚡ 2x Clique
                    </button>
                    <button className="remote-btn" onClick={() => sendMouseClick("right")}>
                      🖱️ Dir.
                    </button>
                    <div className="scroll-pair">
                      <button className="remote-btn small" onClick={() => sendMouseScroll(240)}>
                        ▲
                      </button>
                      <button className="remote-btn small" onClick={() => sendMouseScroll(-240)}>
                        ▼
                      </button>
                    </div>
                  </div>
                </div>

                {/* Teclado Rápido */}
                <div className="remote-section">
                  <span className="section-title">⌨️ Digitar Texto no PC</span>
                  <form className="keyboard-form" onSubmit={(e) => sendKeyboardText(e, false)}>
                    <input
                      type="text"
                      className="keyboard-input"
                      placeholder="Digite texto, senha ou busca..."
                      value={keyboardText}
                      onChange={(e) => setKeyboardText(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      title="Apenas digita o texto sem apertar Enter"
                    >
                      Digitar
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={(e) => sendKeyboardText(e, true)}
                      title="Digita o texto e aperta Enter em seguida"
                    >
                      Enviar ↵
                    </button>
                  </form>

                  <div className="remote-button-group four-cols">
                    <button className="remote-btn" onClick={() => sendKey("backspace")}>
                      ⌫ Apagar
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("space")}>
                      ␣ Espaço
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("tab")}>
                      ⇥ Tab
                    </button>
                    <button className="remote-btn highlight" onClick={() => sendKey("enter")}>
                      ↵ Enter
                    </button>
                  </div>

                  {/* Setas Direcionais */}
                  <div className="remote-button-group four-cols">
                    <button className="remote-btn" onClick={() => sendKey("left")}>
                      ◀ Esq
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("up")}>
                      ▲ Cima
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("down")}>
                      ▼ Baixo
                    </button>
                    <button className="remote-btn" onClick={() => sendKey("right")}>
                      ▶ Dir
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Edição de Jogo e Escolha de Capa (SteamGridDB Gallery) */}
      {editingGame && (
        <div className="modal-backdrop" onClick={() => setEditingGame(null)}>
          <div className="modal-dialog modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="remote-header">
              <h3>✏️ Editar Jogo</h3>
              <button className="remote-close-btn" onClick={() => setEditingGame(null)}>
                ✕
              </button>
            </div>

            <div className="edit-form-group">
              <label>Nome de Exibição</label>
              <input
                type="text"
                className="search-input compact"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={editingGame.originalName}
              />
            </div>

            <div className="edit-form-group">
              <label>Buscar Capa no SteamGridDB</label>
              <div className="cover-search-row">
                <input
                  type="text"
                  className="search-input compact"
                  value={coverQuery}
                  onChange={(e) => setCoverQuery(e.target.value)}
                  placeholder="Nome do jogo para buscar capas..."
                />
                <button
                  className="btn btn-primary"
                  onClick={() => searchCoversForModal(editingGame.id, coverQuery)}
                  disabled={loadingCovers}
                >
                  {loadingCovers ? "..." : "🔍 Buscar"}
                </button>
              </div>
            </div>

            {loadingCovers ? (
              <div className="covers-loading">
                <div className="spinner"></div>
                <span>Buscando capas no SteamGridDB...</span>
              </div>
            ) : coverResults.length > 0 ? (
              <div className="cover-gallery">
                {coverResults.map((item) => (
                  <div
                    key={item.id}
                    className="cover-option"
                    onClick={() => saveGameEdit(item.url)}
                    title={`Aplicar capa de ${item.gameName}`}
                  >
                    <img src={item.thumb} alt={item.gameName} loading="lazy" />
                    <span className="cover-apply-tag">Usar Capa</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-hint">Nenhuma capa listada. Pesquise outro termo ou cole uma URL abaixo.</p>
            )}

            <div className="edit-form-group">
              <label>Ou URL Direta da Imagem (Opcional)</label>
              <input
                type="url"
                className="search-input compact"
                value={customCoverUrl}
                onChange={(e) => setCustomCoverUrl(e.target.value)}
                placeholder="https://exemplo.com/capa.jpg"
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditingGame(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={() => saveGameEdit()}
                disabled={savingEdit}
              >
                {savingEdit ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Energia (Desligar / Suspender) */}
      {powerModal && (
        <div className="modal-backdrop" onClick={() => setPowerModal(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>
              {powerModal === "shutdown"
                ? "🛑 Desligar Computador?"
                : "💤 Suspender Computador?"}
            </h3>
            <p>
              {powerModal === "shutdown"
                ? "O computador na sala será desligado em 30 segundos (você poderá cancelar caso mude de ideia)."
                : "O computador entrará no modo de suspensão."}
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setPowerModal(null)}>
                Cancelar
              </button>
              <button className="btn btn-danger" onClick={() => sendPower(powerModal)}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Menu Lateral (Drawer) - Organiza as opções do sistema */}
      {menuOpen && (
        <div className="side-menu-overlay" onClick={() => setMenuOpen(false)}>
          <aside
            className="side-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="side-menu-header">
              <div className="side-menu-brand">
                <img src="/gamepad.svg" alt="" className="side-menu-logo" />
                <div className="side-menu-brand-text">
                  <strong>GameLauncher</strong>
                  <span className="online-badge">
                    <span className="badge-dot"></span> Online • {SERVER_IP}
                  </span>
                </div>
              </div>
              <button
                className="side-menu-close"
                onClick={() => setMenuOpen(false)}
                aria-label="Fechar menu"
              >
                ✕
              </button>
            </div>

            <div className="side-menu-body">
              {/* Biblioteca */}
              <div className="side-menu-section">
                <span className="side-menu-title">Biblioteca</span>
                <button
                  className={`side-menu-item ${!remoteOpen && selectedFilter === "all" ? "active" : ""}`}
                  onClick={() => menuShowFilter("all")}
                >
                  <span className="side-menu-icon">🏠</span>
                  <span className="side-menu-label">Início</span>
                  <span className="side-menu-count">{counts.all}</span>
                </button>
                <button
                  className={`side-menu-item ${!remoteOpen && selectedFilter === "fav" ? "active" : ""}`}
                  onClick={() => menuShowFilter("fav")}
                >
                  <span className="side-menu-icon">⭐</span>
                  <span className="side-menu-label">Favoritos</span>
                  <span className="side-menu-count">{counts.fav}</span>
                </button>
                {counts.exe > 0 && (
                  <button
                    className={`side-menu-item ${!remoteOpen && selectedFilter === ".exe" ? "active" : ""}`}
                    onClick={() => menuShowFilter(".exe")}
                  >
                    <span className="side-menu-icon">💽</span>
                    <span className="side-menu-label">Executáveis</span>
                    <span className="side-menu-count">{counts.exe}</span>
                  </button>
                )}
                {counts.lnk > 0 && (
                  <button
                    className={`side-menu-item ${!remoteOpen && selectedFilter === ".lnk" ? "active" : ""}`}
                    onClick={() => menuShowFilter(".lnk")}
                  >
                    <span className="side-menu-icon">🔗</span>
                    <span className="side-menu-label">Atalhos</span>
                    <span className="side-menu-count">{counts.lnk}</span>
                  </button>
                )}
                {counts.url > 0 && (
                  <button
                    className={`side-menu-item ${!remoteOpen && selectedFilter === ".url" ? "active" : ""}`}
                    onClick={() => menuShowFilter(".url")}
                  >
                    <span className="side-menu-icon">🌐</span>
                    <span className="side-menu-label">Steam / Web</span>
                    <span className="side-menu-count">{counts.url}</span>
                  </button>
                )}
              </div>

              {/* Exibição */}
              <div className="side-menu-section">
                <span className="side-menu-title">Exibição</span>
                <div className="side-menu-segment" role="group" aria-label="Modo de visualização">
                  <button
                    className={`side-menu-segment-btn ${viewMode === "poster" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic(15);
                      setViewMode("poster");
                    }}
                  >
                    ⊞ Grade
                  </button>
                  <button
                    className={`side-menu-segment-btn ${viewMode === "list" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic(15);
                      setViewMode("list");
                    }}
                  >
                    ☰ Lista
                  </button>
                </div>
                {[
                  { value: "default", icon: "⭐", label: "Destaques & Favoritos" },
                  { value: "recent", icon: "⏱️", label: "Mais Recentes" },
                  { value: "playtime", icon: "🔥", label: "Mais Jogados" },
                  { value: "az", icon: "🔤", label: "Nome (A-Z)" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    className={`side-menu-item compact ${sortBy === opt.value ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic(15);
                      setSortBy(opt.value);
                    }}
                  >
                    <span className="side-menu-icon">{opt.icon}</span>
                    <span className="side-menu-label">{opt.label}</span>
                    {sortBy === opt.value && <span className="side-menu-check">✓</span>}
                  </button>
                ))}
              </div>

              {/* Tempo de Jogo */}
              <div className="side-menu-section">
                <div className="side-menu-title-row">
                  <span className="side-menu-title">Tempo de Jogo</span>
                  <span className="side-menu-title-total">
                    Total: {playTimeRanking.totalLabel}
                  </span>
                </div>

                {playTimeRanking.played.length === 0 ? (
                  <p className="side-menu-empty">Nenhum jogo jogado ainda.</p>
                ) : (
                  <ul className="playtime-list">
                    {playTimeRanking.played.map((item) => (
                      <li
                        key={item.id}
                        className={`playtime-row ${item.isActive ? "live" : ""}`}
                      >
                        {item.cover ? (
                          <img
                            src={`${API}/covers/${item.cover}`}
                            alt=""
                            className="playtime-thumb"
                            loading="lazy"
                          />
                        ) : (
                          <span className="playtime-thumb placeholder">🎮</span>
                        )}
                        <div className="playtime-info">
                          <div className="playtime-line">
                            <span className="playtime-name" title={item.name}>
                              {item.name}
                            </span>
                            <span className="playtime-value">
                              {item.isActive && <span className="dock-pulse-dot static" />}
                              {item.label}
                            </span>
                          </div>
                          <div className="playtime-bar">
                            <span
                              className="playtime-bar-fill"
                              style={{ width: `${item.percent}%` }}
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {playTimeRanking.unplayed.length > 0 && (
                  <>
                    <button
                      className="side-menu-item compact"
                      onClick={() => {
                        triggerHaptic(15);
                        setShowUnplayed((prev) => !prev);
                      }}
                      aria-expanded={showUnplayed}
                    >
                      <span className="side-menu-icon">{showUnplayed ? "▾" : "▸"}</span>
                      <span className="side-menu-label">
                        {showUnplayed ? "Ocultar" : "Mostrar"} não jogados
                      </span>
                      <span className="side-menu-count">{playTimeRanking.unplayed.length}</span>
                    </button>

                    {showUnplayed && (
                      <ul className="playtime-list">
                        {playTimeRanking.unplayed.map((item) => (
                          <li key={item.id} className="playtime-row unplayed">
                            {item.cover ? (
                              <img
                                src={`${API}/covers/${item.cover}`}
                                alt=""
                                className="playtime-thumb"
                                loading="lazy"
                              />
                            ) : (
                              <span className="playtime-thumb placeholder">🎮</span>
                            )}
                            <div className="playtime-info">
                              <div className="playtime-line">
                                <span className="playtime-name" title={item.name}>
                                  {item.name}
                                </span>
                                <span className="playtime-value">—</span>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              {/* Controle do PC */}
              <div className="side-menu-section">
                <span className="side-menu-title">Controle do PC</span>
                <button
                  className={`side-menu-item ${remoteOpen && remoteTab === "controls" ? "active" : ""}`}
                  onClick={() => menuOpenRemote("controls")}
                >
                  <span className="side-menu-icon">🎛️</span>
                  <span className="side-menu-label">Áudio & Sistema</span>
                </button>
                <button
                  className={`side-menu-item ${remoteOpen && remoteTab === "touchpad" ? "active" : ""}`}
                  onClick={() => menuOpenRemote("touchpad")}
                >
                  <span className="side-menu-icon">🖱️</span>
                  <span className="side-menu-label">Touchpad & Teclado</span>
                </button>
                {activeGame && (
                  <button
                    className="side-menu-item warning"
                    onClick={() => menuRun(() => closeActiveGame(false))}
                    title="Envia Alt+F4 suave para o jogo em execução"
                  >
                    <span className="side-menu-icon">✕</span>
                    <span className="side-menu-label">Fechar jogo atual (Alt+F4)</span>
                    <span className="dock-pulse-dot static" />
                  </button>
                )}
              </div>

              {/* Sistema */}
              <div className="side-menu-section">
                <span className="side-menu-title">Sistema</span>
                <button
                  className="side-menu-item"
                  onClick={() => menuRun(refreshGames)}
                  disabled={refreshing}
                >
                  <span className="side-menu-icon">🔄</span>
                  <span className="side-menu-label">
                    {refreshing ? "Atualizando..." : "Atualizar biblioteca"}
                  </span>
                </button>
                <button
                  className="side-menu-item warning"
                  onClick={() => menuRun(() => setPowerModal("sleep"))}
                >
                  <span className="side-menu-icon">💤</span>
                  <span className="side-menu-label">Suspender PC</span>
                </button>
                <button
                  className="side-menu-item danger"
                  onClick={() => menuRun(() => setPowerModal("shutdown"))}
                >
                  <span className="side-menu-icon">🛑</span>
                  <span className="side-menu-label">Desligar PC</span>
                </button>
              </div>
            </div>

            <div className="side-menu-footer">
              <span className="side-menu-footer-count">
                {games.length} {games.length === 1 ? "jogo" : "jogos"}
              </span>
              <span className="side-menu-footer-version">
                v{APP_VERSION}
                {(window.location.port === "8070" || import.meta.env.VITE_PORT === "8070") && (
                  <span className="side-menu-dev-tag">DEV</span>
                )}
              </span>
            </div>
          </aside>
        </div>
      )}

      {/* Floating Bottom Console Dock (Navegação Rápida ao Alcance do Polegar) */}
      <nav className="bottom-dock" aria-label="Navegação Rápida">
        <button
          className={`dock-btn ${!remoteOpen && selectedFilter === "all" ? "active" : ""}`}
          onClick={() => {
            triggerHaptic(20);
            setRemoteOpen(false);
            setSelectedFilter("all");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="dock-icon">🏠</span>
          <span className="dock-label">Início</span>
        </button>

        <button
          className={`dock-btn ${!remoteOpen && selectedFilter === "fav" ? "active" : ""}`}
          onClick={() => {
            triggerHaptic(20);
            setRemoteOpen(false);
            setSelectedFilter("fav");
          }}
        >
          <span className="dock-icon">⭐</span>
          <span className="dock-label">Favoritos</span>
          {counts.fav > 0 && <span className="dock-badge">{counts.fav}</span>}
        </button>

        <button
          className={`dock-btn ${remoteOpen && remoteTab === "touchpad" ? "active" : ""}`}
          onClick={() => {
            triggerHaptic(25);
            setRemoteTab("touchpad");
            setRemoteOpen(true);
          }}
        >
          <span className="dock-icon">🖱️</span>
          <span className="dock-label">Touchpad</span>
        </button>

        <button
          className={`dock-btn highlight-dock ${remoteOpen && remoteTab === "controls" ? "active" : ""}`}
          onClick={() => {
            triggerHaptic(25);
            setRemoteTab("controls");
            setRemoteOpen(true);
          }}
        >
          <span className="dock-icon">🎛️</span>
          <span className="dock-label">Controle PC</span>
          {activeGame && <span className="dock-pulse-dot" title="Jogo em execução" />}
        </button>
      </nav>
    </div>
  );
}