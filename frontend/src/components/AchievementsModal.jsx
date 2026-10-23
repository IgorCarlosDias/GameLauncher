import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  Trophy,
  RotateCcw,
  X,
  Search,
  Check,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
} from "lucide-react";

export default function AchievementsModal({
  game,
  api,
  onClose,
  onOpenSettings,
  showToast,
  triggerHaptic,
  onAchievementsUpdated,
}) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [data, setData] = useState({
    total: 0,
    unlocked: 0,
    percentage: 0,
    achievements: [],
    hasApiKey: true,
  });
  const [filter, setFilter] = useState("all"); // 'all' | 'unlocked' | 'locked'
  const [search, setSearch] = useState("");
  const [revealedSecrets, setRevealedSecrets] = useState({});

  // Fecha no ESC
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Carrega conquistas apenas quando o game.id mudar (sem loop de re-renderização)
  useEffect(() => {
    if (!game?.id) return undefined;
    let cancelled = false;

    async function fetchAchievements() {
      setLoading(true);
      try {
        const res = await axios.get(`${api}/games/${game.id}/achievements`);
        if (cancelled) return;
        if (res.data?.success) {
          setData({
            total: res.data.total || 0,
            unlocked: res.data.unlocked || 0,
            percentage: res.data.percentage || 0,
            achievements: res.data.achievements || [],
            steamId: res.data.steamId || null,
            hasApiKey: res.data.hasApiKey !== false,
            warning: res.data.warning || null,
          });
          if (res.data.warning) {
            showToast(res.data.warning, "warning");
          }
        } else {
          showToast("Não foi possível carregar as conquistas.", "error");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Erro ao carregar conquistas:", err);
        showToast(err.response?.data?.message || "Erro ao carregar conquistas da Steam.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAchievements();

    return () => {
      cancelled = true;
    };
  }, [api, game?.id, showToast]);

  async function handleSync() {
    if (triggerHaptic) triggerHaptic(25);
    setSyncing(true);
    try {
      const res = await axios.post(`${api}/games/${game.id}/sync-achievements`);
      if (res.data?.success) {
        setData({
          total: res.data.total || 0,
          unlocked: res.data.unlocked || 0,
          percentage: res.data.percentage || 0,
          achievements: res.data.achievements || [],
          hasApiKey: true,
          warning: res.data.warning || null,
        });
        showToast(
          `🏆 Conquistas sincronizadas! ${res.data.unlocked} de ${res.data.total} desbloqueadas.`,
          "success"
        );
        if (onAchievementsUpdated) onAchievementsUpdated();
      } else {
        showToast(res.data?.message || "Falha ao sincronizar conquistas", "error");
      }
    } catch (err) {
      const msg = err.response?.data?.message || "Erro ao conectar com a Steam API";
      showToast(msg, "error");
    } finally {
      setSyncing(false);
    }
  }

  function toggleSecret(apiName) {
    if (triggerHaptic) triggerHaptic(15);
    setRevealedSecrets((prev) => ({
      ...prev,
      [apiName]: !prev[apiName],
    }));
  }

  function formatUnlockDate(isoString) {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  const filteredAchievements = (data.achievements || []).filter((ach) => {
    if (filter === "unlocked" && !ach.achieved) return false;
    if (filter === "locked" && ach.achieved) return false;
    if (search.trim()) {
      const term = search.toLowerCase();
      const matchName = ach.name?.toLowerCase().includes(term);
      const matchDesc = ach.description?.toLowerCase().includes(term);
      if (!matchName && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog achievements-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sheet__handle" />

        {/* Header do Jogo e Fechamento */}
        <div className="achievements-header">
          <div className="achievements-game-info">
            {game.cover ? (
              <img
                src={`${api}/covers/${game.cover}`}
                alt={game.name}
                className="achievements-game-cover"
              />
            ) : (
              <div className="achievements-game-cover placeholder">
                <Trophy size={24} />
              </div>
            )}
            <div className="achievements-game-meta">
              <span className="achievements-tag">
                {game.extension === ".url" ? "CONQUISTAS STEAM" : "CONQUISTAS (JOGO LOCAL)"}
              </span>
              <h2 title={game.name}>{game.name}</h2>
              {(data.steamId || game.steamId) && (
                <span className="achievements-appid">AppID {data.steamId || game.steamId}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn-icon modal-close-btn"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Alerta se não houver Chave da Steam configurada */}
        {!data.hasApiKey && (
          <div className="achievements-alert-box warning">
            <div className="alert-content">
              <strong>
                <AlertTriangle size={15} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Chave da API Steam não configurada
              </strong>
              <p>
                Para sincronizar e atualizar as conquistas da sua conta Steam, adicione sua chave
                gratuita na tela de configurações.
              </p>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onClose();
                  onOpenSettings("steam");
                }}
              >
                Configurar
              </button>
            )}
          </div>
        )}

        {/* Barra de Progresso Geral */}
        <div className="achievements-progress-card">
          <div className="progress-top-row">
            <span className="progress-label">
              Progresso:{" "}
              <strong>
                {data.unlocked} / {data.total} ({data.percentage}%)
              </strong>
            </span>
            <button
              type="button"
              className={`btn-sync-achievements ${syncing ? "spinning" : ""}`}
              onClick={handleSync}
              disabled={syncing || !(data.steamId || game.steamId)}
              title="Sincronizar conquistas"
            >
              <RotateCcw size={14} className={syncing ? "spin" : ""} />
              <span>{syncing ? "Sincronizando..." : "Sincronizar"}</span>
            </button>
          </div>
          <div className="achievements-progress-bar-bg">
            <div
              className="achievements-progress-bar-fill"
              style={{ width: `${Math.min(100, Math.max(0, data.percentage))}%` }}
            />
          </div>
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="achievements-toolbar">
          <div className="achievements-tabs">
            <button
              type="button"
              className={`ach-tab-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              Todas <span className="ach-count">{data.total}</span>
            </button>
            <button
              type="button"
              className={`ach-tab-btn ${filter === "unlocked" ? "active" : ""}`}
              onClick={() => setFilter("unlocked")}
            >
              Desbloqueadas <span className="ach-count">{data.unlocked}</span>
            </button>
            <button
              type="button"
              className={`ach-tab-btn ${filter === "locked" ? "active" : ""}`}
              onClick={() => setFilter("locked")}
            >
              Bloqueadas <span className="ach-count">{data.total - data.unlocked}</span>
            </button>
          </div>
          <div className="achievements-search">
            <Search size={14} className="ach-search-icon" />
            <input
              type="search"
              placeholder="Buscar conquista..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ach-search-input"
            />
            {search && (
              <button
                type="button"
                className="ach-search-clear"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Lista de Conquistas com Scroll Flexível */}
        <div className="achievements-list-container">
          {loading ? (
            <div className="achievements-loading">
              <span className="btn-spinner" /> Carregando conquistas...
            </div>
          ) : data.total === 0 ? (
            <div className="achievements-empty">
              <span className="empty-icon">
                <Trophy size={42} strokeWidth={1.5} />
              </span>
              <h4>Nenhuma conquista encontrada</h4>
              <p>
                Este jogo pode não ter conquistas na Steam ou elas ainda não foram sincronizadas.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSync}
                disabled={syncing || !(data.steamId || game.steamId)}
              >
                <RotateCcw size={16} /> Sincronizar Agora
              </button>
            </div>
          ) : filteredAchievements.length === 0 ? (
            <div className="achievements-empty">
              <p>Nenhuma conquista encontrada com o filtro atual.</p>
            </div>
          ) : (
            <div className="achievements-grid">
              {filteredAchievements.map((ach) => {
                const isSecret = ach.hidden && !ach.achieved;
                const isRevealed = revealedSecrets[ach.apiName];
                const iconSrc = ach.achieved
                  ? ach.iconUrl
                  : ach.iconGrayUrl || ach.iconUrl;

                return (
                  <div
                    key={ach.apiName || ach.id}
                    className={`achievement-card ${ach.achieved ? "unlocked" : "locked"}`}
                  >
                    <div className="achievement-icon-wrapper">
                      {iconSrc ? (
                        <img
                          src={iconSrc}
                          alt={ach.name}
                          className="achievement-icon"
                          loading="lazy"
                        />
                      ) : (
                        <div className="achievement-icon placeholder">
                          {ach.achieved ? <Trophy size={20} /> : <Lock size={20} />}
                        </div>
                      )}
                      {ach.achieved && (
                        <span className="ach-check-badge">
                          <Check size={11} strokeWidth={3} />
                        </span>
                      )}
                    </div>

                    <div className="achievement-details">
                      <div className="achievement-title-row">
                        <strong className="achievement-title">
                          {isSecret && !isRevealed ? "Conquista Oculta" : ach.name}
                        </strong>
                        {ach.achieved ? (
                          <span className="ach-status-badge unlocked">Desbloqueada</span>
                        ) : (
                          <span className="ach-status-badge locked">Bloqueada</span>
                        )}
                      </div>

                      <p className="achievement-desc">
                        {isSecret && !isRevealed
                          ? "Esta conquista possui detalhes secretos na Steam."
                          : ach.description || "Sem descrição disponível."}
                      </p>

                      <div className="achievement-footer-meta">
                        {isSecret && (
                          <button
                            type="button"
                            className="btn-reveal-secret"
                            onClick={() => toggleSecret(ach.apiName)}
                          >
                            {isRevealed ? (
                              <>
                                <EyeOff size={13} /> Ocultar spoiler
                              </>
                            ) : (
                              <>
                                <Eye size={13} /> Revelar spoiler
                              </>
                            )}
                          </button>
                        )}

                        {ach.achieved && ach.unlockDate && (
                          <span className="ach-unlock-time">
                            📅 {formatUnlockDate(ach.unlockDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rodapé com Botão Fechar Ergonômico */}
        <div className="achievements-modal-footer">
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
