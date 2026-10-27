import React, { useRef, useState, useEffect, useMemo } from "react";
import { Download, Upload, RefreshCw, Cloud, ChevronRight, Search, Trophy, History } from "lucide-react";
import { coverUrl } from "../api";
import { formatPlayTimeDetailed, formatPlayTime, formatDateTime } from "../lib/format";
import Segmented from "../components/ui/Segmented";
import LiveDuration from "../components/ui/LiveDuration";
import { haptic } from "../lib/haptics";

export default function StatsPage({ times, games, activeSession, onOpenGame }) {
  const fileInputRef = useRef(null);
  const [importMode, setImportMode] = useState("merge"); // 'merge' | 'replace'
  const [search, setSearch] = useState("");

  const { summary, sessions, busy, load, exportJson, importFile, reloadLocal, cloudPush } = times;

  useEffect(() => {
    load();
  }, [load]);

  const IMPORT_MODES = [
    { id: "merge", label: "Mesclar (Manter Maiores)" },
    { id: "replace", label: "Substituir pelo JSON" },
  ];

  // Ordena os jogos por tempo jogado acumulado
  const sortedGames = useMemo(() => {
    return [...games]
      .filter((g) => (g.playTime || 0) > 0)
      .sort((a, b) => (b.playTime || 0) - (a.playTime || 0));
  }, [games]);

  const maxPlayTime = sortedGames[0]?.playTime || 1;

  // Filtro de busca na lista de ranking
  const filteredSortedGames = useMemo(() => {
    if (!search.trim()) return sortedGames;
    const term = search.trim().toLowerCase();
    return sortedGames.filter((g) => g.name?.toLowerCase().includes(term));
  }, [sortedGames, search]);

  const getRankBadge = (actualRank) => {
    if (actualRank === 0) return <span className="stats-rank-num stats-rank-num--gold" title="1º Lugar">🥇</span>;
    if (actualRank === 1) return <span className="stats-rank-num stats-rank-num--silver" title="2º Lugar">🥈</span>;
    if (actualRank === 2) return <span className="stats-rank-num stats-rank-num--bronze" title="3º Lugar">🥉</span>;
    return <span className="stats-rank-num">#{actualRank + 1}</span>;
  };

  const handleOpenGame = (game) => {
    haptic?.tap?.();
    if (onOpenGame) onOpenGame(game);
  };

  return (
    <div className="stats-page-container">
      <header className="page-header">
        <h2 className="page-title">⏱️ Métricas & Telemetria</h2>
        <p className="page-subtitle">Tempo de sofá, histórico de sessões e backup de dados</p>
      </header>

      {/* Sessão ativa ao vivo se houver jogo em execução */}
      {activeSession && (
        <div
          className="stats-live-banner"
          onClick={() => handleOpenGame(activeSession)}
          role="button"
          tabIndex={0}
        >
          <div className="stats-live-thumb">
            {coverUrl(activeSession.cover) ? (
              <img src={coverUrl(activeSession.cover)} alt="" />
            ) : (
              <div className="placeholder">🎮</div>
            )}
          </div>
          <div className="stats-live-info">
            <div className="stats-live-pill">
              <span className="live-dot" />
              <span>Sessão em andamento</span>
            </div>
            <strong className="stats-live-title">{activeSession.name}</strong>
            <span className="stats-live-timer">
              ⏱️ <LiveDuration startedAt={activeSession.startedAt} />
            </span>
          </div>
          <ChevronRight size={18} className="stats-live-chevron" />
        </div>
      )}

      {/* Grid com os 4 cards principais de telemetria */}
      <div className="stats-metric-grid">
        <div className="metric-box metric-box--highlight">
          <div className="metric-box-icon-pill">🛋️</div>
          <div className="metric-box-content">
            <span className="metric-box-label">Tempo Total no Sofá</span>
            <strong className="metric-box-number">
              {summary?.couchTimeFormatted || formatPlayTimeDetailed(summary?.couchTimeSeconds)}
            </strong>
            <span className="metric-box-sub">
              {summary?.couchTimeSeconds ? `${summary.couchTimeSeconds}s registrados` : "Sincronizado via JSON"}
            </span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-box-icon-pill">🎮</div>
          <div className="metric-box-content">
            <span className="metric-box-label">Tempo em Jogos</span>
            <strong className="metric-box-number">
              {summary?.gamesPlayTimeFormatted || formatPlayTimeDetailed(summary?.gamesPlayTimeSeconds)}
            </strong>
            <span className="metric-box-sub">
              {summary?.playedGamesCount ?? sortedGames.length} de {summary?.totalGames ?? games.length} títulos
            </span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-box-icon-pill">📊</div>
          <div className="metric-box-content">
            <span className="metric-box-label">Sessões Concluídas</span>
            <strong className="metric-box-number">
              {summary?.totalSessionsRecorded ?? sessions.length}
            </strong>
            <span className="metric-box-sub">
              {summary?.totalPlayCount ?? 0} partidas iniciadas
            </span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-box-icon-pill">👑</div>
          <div className="metric-box-content">
            <span className="metric-box-label">Mais Jogado</span>
            <strong className="metric-box-number truncate">
              {sortedGames[0]?.name || "—"}
            </strong>
            <span className="metric-box-sub">
              {sortedGames[0] ? formatPlayTime(sortedGames[0].playTime) : "Nenhum jogo ainda"}
            </span>
          </div>
        </div>
      </div>

      {/* Ações de Backup & JSON */}
      <section className="stats-section-card">
        <div className="stats-card-head">
          <div className="stats-card-head-title">
            <h3>Backup & Sincronização (.JSON)</h3>
            <p>Exporte seus dados para nuvem ou restaure em outro aparelho</p>
          </div>
        </div>

        <div className="import-mode-selector">
          <span className="field__label">Modo de Importação:</span>
          <Segmented
            options={IMPORT_MODES}
            value={importMode}
            onChange={setImportMode}
            label="Modo de Importação"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importFile(file, importMode);
            e.target.value = "";
          }}
        />

        <div className="stats-action-buttons">
          <button
            type="button"
            className="btn btn-primary"
            onClick={exportJson}
            disabled={Boolean(busy)}
            title="Exportar JSON"
          >
            <Download size={16} />
            <span>{busy === "export" ? "Exportando..." : "Exportar JSON"}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(busy)}
            title="Importar Arquivo"
          >
            <Upload size={16} />
            <span>{busy === "import" ? "Importando..." : "Importar Arquivo"}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => reloadLocal(importMode)}
            disabled={Boolean(busy)}
            title="Lê novamente o arquivo backend/playtime.json"
          >
            <RefreshCw size={16} />
            <span>{busy === "reload" ? "Lendo..." : "Ler JSON Local"}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={cloudPush}
            disabled={Boolean(busy)}
            title="Sincronizar com Supabase"
          >
            <Cloud size={16} />
            <span>{busy === "cloud" ? "Enviando..." : "Sync Supabase"}</span>
          </button>
        </div>
      </section>

      {/* Ranking de Jogos mais Jogados */}
      <section className="stats-section-card">
        <div className="stats-card-head">
          <div className="stats-card-head-title">
            <div className="stats-card-head-badge">
              <Trophy size={16} className="stats-badge-icon" />
              <h3>Ranking de Tempo por Jogo</h3>
            </div>
            <p>{sortedGames.length} títulos com tempo contabilizado</p>
          </div>
        </div>

        {sortedGames.length > 4 && (
          <div className="stats-search-wrapper">
            <Search size={15} className="stats-search-icon" />
            <input
              type="text"
              className="stats-search-input"
              placeholder="Buscar título no ranking..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="stats-search-clear"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
              >
                ×
              </button>
            )}
          </div>
        )}

        {filteredSortedGames.length === 0 ? (
          <p className="muted-hint text-center py-4">
            {search ? "Nenhum jogo encontrado com esse termo." : "Nenhum tempo computado ainda. Inicie um jogo!"}
          </p>
        ) : (
          <div className="stats-games-ranking">
            {filteredSortedGames.map((game) => {
              const actualRank = sortedGames.findIndex((g) => g.id === game.id);
              const cover = coverUrl(game.cover);
              const percent = Math.min(100, Math.max(4, Math.round((game.playTime / maxPlayTime) * 100)));
              const isCurrent = activeSession?.id === game.id;

              return (
                <div
                  key={game.id}
                  className={`stats-ranking-row ${isCurrent ? "is-live" : ""}`}
                  onClick={() => handleOpenGame(game)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="stats-rank-num-wrap">
                    {getRankBadge(actualRank)}
                  </div>
                  <div className="stats-rank-thumb">
                    {cover ? (
                      <img src={cover} alt="" loading="lazy" />
                    ) : (
                      <div className="placeholder">🎮</div>
                    )}
                  </div>
                  <div className="stats-rank-info">
                    <div className="stats-rank-title-row">
                      <strong className="stats-rank-title">{game.name}</strong>
                      <span className="stats-rank-duration">
                        {isCurrent && <span className="live-dot-inline" title="Jogando agora" />}
                        {formatPlayTimeDetailed(game.playTime)}
                      </span>
                    </div>
                    <div className="stats-rank-bar-track">
                      <div
                        className="stats-rank-bar-fill"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                  <ChevronRight size={16} className="stats-rank-chevron" />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Histórico Recente de Sessões */}
      {sessions.length > 0 && (
        <section className="stats-section-card">
          <div className="stats-card-head">
            <div className="stats-card-head-title">
              <div className="stats-card-head-badge">
                <History size={16} className="stats-badge-icon" />
                <h3>Histórico de Sessões Recentes</h3>
              </div>
              <p>Últimas {Math.min(sessions.length, 15)} partidas finalizadas</p>
            </div>
          </div>

          <div className="sessions-list">
            {sessions.slice(0, 15).map((s, idx) => (
              <div key={s.id || idx} className="session-item-row">
                <div className="session-item-icon">🎮</div>
                <div className="session-item-info">
                  <strong>{s.gameName || `Jogo #${s.gameId}`}</strong>
                  <small>
                    {s.endedAt
                      ? formatDateTime(s.endedAt)
                      : s.startedAt
                      ? formatDateTime(s.startedAt)
                      : "—"}
                  </small>
                </div>
                <div className="session-item-duration">
                  <span>⏱️ {s.durationFormatted || formatPlayTimeDetailed(s.duration)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
