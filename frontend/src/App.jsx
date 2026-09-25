import { useEffect, useState, useRef, useMemo } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

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

// Format seconds into HH:MM:SS or MM:SS
function formatTimer(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default function App() {
  const [games, setGames] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("all"); // 'all' | '.exe' | '.lnk' | '.url'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);

  // Active game & remote states
  const [activeGame, setActiveGame] = useState(null);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [powerModal, setPowerModal] = useState(null); // 'sleep' | 'shutdown' | 'restart' | null
  const [shutdownScheduled, setShutdownScheduled] = useState(false);

  const toastTimerRef = useRef(null);

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
      if (response.data && response.data.activeGame) {
        setActiveGame(response.data.activeGame);
      } else {
        setActiveGame(null);
      }
    } catch {
      // Ignora falha de polling silencioso
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

  // Iniciar jogo
  async function playGame(game) {
    triggerHaptic(40);
    setLaunchingId(game.id);
    showToast(`Iniciando ${game.name}...`, "info");

    try {
      const res = await axios.post(`${API}/play`, { id: game.id });
      if (res.data.success) {
        setActiveGame({
          id: game.id,
          name: game.name,
          cover: game.cover,
          startedAt: new Date().toISOString()
        });
        setActiveSeconds(0);
        showToast(`🎮 ${game.name} iniciado no PC!`, "success");
      }
    } catch (err) {
      console.error("Erro iniciando jogo:", err);
      showToast("Erro ao abrir jogo no computador", "error");
    } finally {
      setLaunchingId(null);
    }
  }

  // Encerrar jogo atual (com taskkill)
  async function closeActiveGame(force = true) {
    triggerHaptic(50);
    showToast(force ? "Encerrando processo com taskkill..." : "Enviando Alt+F4...", "info");
    try {
      const res = await axios.post(`${API}/system/close-game`, { force });
      showToast(res.data?.message || (force ? "Jogo encerrado via taskkill" : "Alt+F4 enviado ao PC"), "success");
      setActiveGame(null);
      setActiveSeconds(0);
    } catch (err) {
      console.error("Erro ao fechar:", err);
      showToast("Falha ao encerrar jogo", "error");
    }
  }

  // Dispensar barra de jogo ativo sem mandar comando
  async function dismissActiveGame() {
    triggerHaptic(20);
    try {
      await axios.post(`${API}/system/clear-active`);
    } catch {
      // ignore
    }
    setActiveGame(null);
    setActiveSeconds(0);
  }

  // Controle de volume
  async function sendVolume(action) {
    triggerHaptic(25);
    try {
      await axios.post(`${API}/system/volume`, { action });
      const labels = { up: "Volume +", down: "Volume -", mute: "Mudo alternado" };
      showToast(labels[action] || "Volume ajustado", "info");
    } catch {
      showToast("Falha ao ajustar volume", "error");
    }
  }

  // Controle de mídia
  async function sendMedia(action) {
    triggerHaptic(25);
    try {
      await axios.post(`${API}/system/media`, { action });
      const labels = { play_pause: "Play / Pause", next: "Próxima faixa", prev: "Faixa anterior" };
      showToast(labels[action] || "Comando de mídia enviado", "info");
    } catch {
      showToast("Falha no comando de mídia", "error");
    }
  }

  // Teclas de atalho
  async function sendKey(key) {
    triggerHaptic(30);
    try {
      await axios.post(`${API}/system/key`, { key });
      const labels = { alttab: "Alt + Tab enviado", escape: "Esc enviado", enter: "Enter enviado" };
      showToast(labels[key] || "Tecla enviada", "info");
    } catch {
      showToast("Falha ao enviar tecla", "error");
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

    // Polling a cada 10s para verificar status do jogo
    const interval = setInterval(checkActiveGame, 10000);
    return () => clearInterval(interval);
  }, []);

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

  // Filtragem dos jogos
  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      const matchesSearch = game.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      if (selectedFilter === "all") return true;
      if (selectedFilter === ".exe") return game.extension === ".exe";
      if (selectedFilter === ".lnk") return game.extension === ".lnk";
      if (selectedFilter === ".url") return game.extension === ".url";
      return true;
    });
  }, [games, search, selectedFilter]);

  // Contadores para os filtros
  const counts = useMemo(() => {
    return {
      all: games.length,
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
          <div className="brand" onClick={() => { setSearch(""); setSelectedFilter("all"); }}>
            <img src="/gamepad.svg" alt="GameLauncher" className="brand-logo" />
            <div className="brand-text">
              <h1>GameLauncher</h1>
              <span className="online-badge">
                <span className="badge-dot"></span> Online
              </span>
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
                    <span className="banner-pid" title="Process ID">PID: {activeGame.pid}</span>
                  )}
                  {activeGame.exeName && (
                    <span className="banner-exe">{activeGame.exeName}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="banner-buttons">
              <button
                className="btn btn-close-taskkill"
                onClick={() => closeActiveGame(true)}
                title="Encerra o processo do jogo imediatamente via taskkill"
              >
                🛑 Encerrar Jogo (Taskkill)
              </button>
              <button
                className="btn btn-close-soft"
                onClick={() => closeActiveGame(false)}
                title="Envia Alt+F4 para tentar salvar o progresso antes de sair"
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
        {/* Barra de Pesquisa e Filtros */}
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

          {/* Filtros em Pílula */}
          <div className="filter-pills">
            <button
              className={`pill ${selectedFilter === "all" ? "active" : ""}`}
              onClick={() => { triggerHaptic(15); setSelectedFilter("all"); }}
            >
              Todos ({counts.all})
            </button>
            {counts.exe > 0 && (
              <button
                className={`pill ${selectedFilter === ".exe" ? "active" : ""}`}
                onClick={() => { triggerHaptic(15); setSelectedFilter(".exe"); }}
              >
                Executáveis ({counts.exe})
              </button>
            )}
            {counts.lnk > 0 && (
              <button
                className={`pill ${selectedFilter === ".lnk" ? "active" : ""}`}
                onClick={() => { triggerHaptic(15); setSelectedFilter(".lnk"); }}
              >
                Atalhos ({counts.lnk})
              </button>
            )}
            {counts.url > 0 && (
              <button
                className={`pill ${selectedFilter === ".url" ? "active" : ""}`}
                onClick={() => { triggerHaptic(15); setSelectedFilter(".url"); }}
              >
                Steam / Web ({counts.url})
              </button>
            )}
          </div>
        </section>

        {/* Estados de Carregamento e Erro */}
        {loading && (
          <div className="state-feedback">
            <div className="spinner"></div>
            <p>Carregando biblioteca do PC...</p>
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

        {/* Grade de Jogos */}
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
            ) : (
              <div className="grid">
                {filteredGames.map((game) => {
                  const isLaunching = launchingId === game.id;
                  const isCurrent = activeGame && activeGame.id === game.id;

                  return (
                    <article
                      className={`card ${isCurrent ? "current-running" : ""}`}
                      key={game.id}
                    >
                      <div className="card-cover-container">
                        {game.cover ? (
                          <img
                            src={`${API}/covers/${game.cover}`}
                            alt={game.name}
                            loading="lazy"
                            className="card-cover-image"
                          />
                        ) : (
                          <div className="no-cover">
                            <span className="no-cover-icon">🎮</span>
                            <span className="no-cover-text">{game.name}</span>
                          </div>
                        )}

                        {/* Tag da extensão */}
                        <span className={`badge-ext badge-${game.extension?.replace(".", "")}`}>
                          {game.extension === ".url"
                            ? "Steam"
                            : game.extension === ".lnk"
                            ? "Atalho"
                            : "Jogo"}
                        </span>

                        {isCurrent && <span className="badge-running">Em Execução</span>}
                      </div>

                      <div className="card-info">
                        <h2 title={game.name} className="game-title">
                          {game.name}
                        </h2>

                        <div className="card-btn-row">
                          <button
                            className={`btn btn-play ${isLaunching ? "launching" : ""}`}
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
                              className="btn btn-card-kill"
                              onClick={(e) => {
                                e.stopPropagation();
                                closeActiveGame(true);
                              }}
                              title="Encerrar processo do jogo via taskkill"
                            >
                              🛑 Fechar
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
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

            <div className="remote-body">
              {/* Seção Volume */}
              <div className="remote-section">
                <span className="section-title">🔊 Volume do Windows</span>
                <div className="remote-button-group">
                  <button className="remote-btn" onClick={() => sendVolume("mute")}>
                    🔇 Mudo
                  </button>
                  <button className="remote-btn" onClick={() => sendVolume("down")}>
                    🔉 - Volume
                  </button>
                  <button className="remote-btn" onClick={() => sendVolume("up")}>
                    🔊 + Volume
                  </button>
                </div>
              </div>

              {/* Seção Mídia */}
              <div className="remote-section">
                <span className="section-title">🎵 Reprodução</span>
                <div className="remote-button-group">
                  <button className="remote-btn" onClick={() => sendMedia("prev")}>
                    ⏮ Anterior
                  </button>
                  <button className="remote-btn highlight" onClick={() => sendMedia("play_pause")}>
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
                    🗔 Alt + Tab
                  </button>
                  <button className="remote-btn" onClick={() => sendKey("escape")}>
                    ⎋ Esc
                  </button>
                  <button className="remote-btn" onClick={() => sendKey("enter")}>
                    ↵ Enter
                  </button>
                </div>
              </div>

              {/* Seção Encerrar Jogo (Taskkill) */}
              <div className="remote-section">
                <span className="section-title">🛑 Encerramento Forçado (Taskkill)</span>
                <div className="remote-kill-container">
                  {activeGame ? (
                    <button
                      className="remote-btn btn-danger-action btn-kill-wide"
                      onClick={() => {
                        setRemoteOpen(false);
                        closeActiveGame(true);
                      }}
                    >
                      🛑 Encerrar {activeGame.name} {activeGame.pid ? `(PID: ${activeGame.pid})` : ""}
                    </button>
                  ) : (
                    <button
                      className="remote-btn btn-danger-action btn-kill-wide"
                      onClick={() => {
                        setRemoteOpen(false);
                        closeActiveGame(true);
                      }}
                    >
                      🛑 Forçar Fechamento de Jogo / Janela Ativa na TV (Taskkill)
                    </button>
                  )}
                </div>
              </div>

              {/* Seção Energia do Computador */}
              <div className="remote-section">
                <span className="section-title">⚡ Energia do Computador</span>
                <div className="remote-button-group">
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
              <button
                className="btn btn-danger"
                onClick={() => sendPower(powerModal)}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}