import React, { useRef, useState, useEffect } from "react";
import { Download, Upload, RefreshCw, Cloud } from "lucide-react";
import { coverUrl } from "../api";
import { formatPlayTimeDetailed, formatPlayTime, formatDateTime } from "../lib/format";
import Segmented from "../components/ui/Segmented";

export default function StatsPage({ times, games, activeSession, onOpenGame }) {
  const fileInputRef = useRef(null);
  const [importMode, setImportMode] = useState("merge"); // 'merge' | 'replace'

  const { summary, sessions, busy, load, exportJson, importFile, reloadLocal, cloudPush } = times;

  useEffect(() => {
    load();
  }, [load]);

  const IMPORT_MODES = [
    { id: "merge", label: "Mesclar (Manter Maiores)" },
    { id: "replace", label: "Substituir pelo JSON" },
  ];

  // Ordena os jogos por tempo jogado acumulado
  const sortedGames = [...games]
    .filter((g) => (g.playTime || 0) > 0)
    .sort((a, b) => (b.playTime || 0) - (a.playTime || 0));

  const maxPlayTime = sortedGames[0]?.playTime || 1;

  return (
    <div className="stats-page-container">
      <header className="page-header">
        <h2 className="page-title">⏱️ Métricas & Telemetria</h2>
        <p className="page-subtitle">Tempo de sofá, histórico de sessões e backup de dados</p>
      </header>

      {/* Grid com os 4 cards principais de telemetria */}
      <div className="stats-metric-grid">
        <div className="metric-box metric-box--highlight">
          <div className="metric-box-icon">🛋️</div>
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
          <div className="metric-box-icon">🎮</div>
          <div className="metric-box-content">
            <span className="metric-box-label">Tempo em Jogos</span>
            <strong className="metric-box-number">
              {summary?.gamesPlayTimeFormatted || formatPlayTimeDetailed(summary?.gamesPlayTimeSeconds)}
            </strong>
            <span className="metric-box-sub">
              {summary?.playedGamesCount ?? sortedGames.length} de {summary?.totalGames ?? games.length} jogos jogados
            </span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-box-icon">📊</div>
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
          <div className="metric-box-icon">👑</div>
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
          <h3>Backup & Sincronização (.JSON)</h3>
          <p>Exporte seus dados para salvar na nuvem ou restaurar em outro dispositivo.</p>
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
          >
            <Download size={16} />
            <span>{busy === "export" ? "Exportando..." : "Exportar JSON"}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(busy)}
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
            <span>Ler JSON Local</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={cloudPush}
            disabled={Boolean(busy)}
          >
            <Cloud size={16} />
            <span>{busy === "cloud" ? "Enviando..." : "Sync Supabase"}</span>
          </button>
        </div>
      </section>

      {/* Ranking de Jogos mais Jogados */}
      <section className="stats-section-card">
        <div className="stats-card-head">
          <h3>Ranking de Tempo por Jogo</h3>
          <p>{sortedGames.length} títulos com tempo contabilizado</p>
        </div>

        {sortedGames.length === 0 ? (
          <p className="muted-hint text-center py-4">Nenhum tempo computado ainda. Inicie um jogo!</p>
        ) : (
          <div className="stats-games-ranking">
            {sortedGames.map((game, index) => {
              const cover = coverUrl(game.cover);
              const percent = Math.min(100, Math.max(4, Math.round((game.playTime / maxPlayTime) * 100)));
              const isCurrent = activeSession?.id === game.id;

              return (
                <div
                  key={game.id}
                  className={`stats-ranking-row ${isCurrent ? "is-live" : ""}`}
                  onClick={() => onOpenGame && onOpenGame(game)}
                >
                  <span className="stats-rank-num">#{index + 1}</span>
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
            <h3>Histórico de Sessões Recentes</h3>
            <p>Últimas {Math.min(sessions.length, 15)} partidas finalizadas</p>
          </div>

          <div className="sessions-list">
            {sessions.slice(0, 15).map((s, idx) => (
              <div key={s.id || idx} className="session-item-row">
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
