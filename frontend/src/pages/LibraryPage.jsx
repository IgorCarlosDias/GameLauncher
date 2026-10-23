import React, { useState, useMemo } from "react";
import NowPlaying from "../components/library/NowPlaying";
import TelemetryCard from "../components/library/TelemetryCard";
import ContinueRail from "../components/library/ContinueRail";
import LibraryToolbar from "../components/library/LibraryToolbar";
import GameCard from "../components/library/GameCard";
import GameRow from "../components/library/GameRow";
import LibrarySkeleton from "../components/library/LibrarySkeleton";
import EmptyLibrary from "../components/library/EmptyLibrary";
import GameActionsSheet from "../components/library/GameActionsSheet";
import EditGameSheet from "../components/library/EditGameSheet";
import ConfirmDialog from "../components/ui/ConfirmDialog";

import { filterAndSortGames, countByFilter, getRecentGames } from "../lib/games";

export default function LibraryPage({
  library,
  activeGamesManager,
  pcStatus,
  onOpenAchievements,
  onOpenStats,
  onSoftClose,
}) {
  const { games, loading, refreshing, rescan, toggleFavorite, updateGame } = library;
  const { activeGames, launchingId, launch, close, dismiss } = activeGamesManager;

  // Filtros, Busca e Exibição
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // 'all' | 'fav' | 'steam' | 'local'
  const [sortBy, setSortBy] = useState("default"); // 'default' | 'recent' | 'playtime' | 'az'
  const [viewMode, setViewMode] = useState("grid"); // 'grid' | 'list'

  // Modais de Ações e Edição
  const [actionGame, setActionGame] = useState(null);
  const [editingGame, setEditingGame] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [forceKillTarget, setForceKillTarget] = useState(null);

  // Set de IDs dos jogos ativos para lookup O(1)
  const runningIds = useMemo(() => new Set(activeGames.map((g) => g.id)), [activeGames]);

  // Contagens para os chips
  const counts = useMemo(() => countByFilter(games), [games]);

  // Jogos filtrados e ordenados
  const displayedGames = useMemo(
    () => filterAndSortGames(games, { search, filter, sortBy }),
    [games, search, filter, sortBy]
  );

  // Jogos recentes para o carrossel (apenas quando não há busca ativa)
  const recentGames = useMemo(() => {
    if (search.trim() || filter !== "all") return [];
    return getRecentGames(games, 8);
  }, [games, search, filter]);

  // Tempo total acumulado da biblioteca
  const totalSeconds = useMemo(
    () => games.reduce((acc, g) => acc + (Number(g.playTime) || 0), 0),
    [games]
  );

  // Jogo atualmente em execução para o card de telemetria
  const currentSession = activeGames[0] || null;

  async function handleSaveEdit(id, payload) {
    setSavingEdit(true);
    const ok = await updateGame(id, payload);
    setSavingEdit(false);
    if (ok) setEditingGame(null);
  }

  function handleOpenActions(game) {
    setActionGame(game);
  }

  function handleOpenEdit(game) {
    setActionGame(null);
    setEditingGame(game);
  }

  function handleConfirmForceClose(game) {
    setActionGame(null);
    setForceKillTarget({
      id: game.id,
      name: game.name,
      exeName: game.resolvedExe,
    });
  }

  return (
    <div className="library-page-container">
      {/* 1. Banner "Jogando agora" no topo */}
      <NowPlaying
        activeGames={activeGames}
        onForceClose={handleConfirmForceClose}
        onDismiss={dismiss}
      />

      {/* 2. Card de Telemetria Compacto */}
      {!search && filter === "all" && (
        <TelemetryCard
          session={currentSession}
          totalSeconds={totalSeconds}
          gamesCount={games.length}
          onOpen={onOpenStats}
        />
      )}

      {/* 3. Carrossel Continuar Jogando */}
      {recentGames.length > 0 && (
        <ContinueRail
          games={recentGames}
          runningIds={runningIds}
          launchingId={launchingId}
          onLaunch={launch}
          onOpenActions={handleOpenActions}
        />
      )}

      {/* 4. Toolbar: Busca, Filtros, Ordenação e Grade/Lista */}
      <LibraryToolbar
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        sortBy={sortBy}
        onSort={setSortBy}
        viewMode={viewMode}
        onViewMode={setViewMode}
      />

      {/* 5. Catálogo de Jogos (ou Skeleton / Vazio) */}
      {loading ? (
        <LibrarySkeleton count={viewMode === "list" ? 8 : 6} viewMode={viewMode} />
      ) : displayedGames.length === 0 ? (
        <EmptyLibrary
          hasFilter={Boolean(search.trim() || filter !== "all")}
          onClearFilter={() => {
            setSearch("");
            setFilter("all");
          }}
          onRescan={rescan}
          refreshing={refreshing}
        />
      ) : viewMode === "grid" ? (
        <div className="games-grid">
          {displayedGames.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              running={runningIds.has(game.id)}
              launching={launchingId === game.id}
              onLaunch={launch}
              onOpenActions={handleOpenActions}
            />
          ))}
        </div>
      ) : (
        <div className="games-list">
          {displayedGames.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              running={runningIds.has(game.id)}
              launching={launchingId === game.id}
              onLaunch={launch}
              onOpenActions={handleOpenActions}
            />
          ))}
        </div>
      )}

      {/* 6. Sheets e Diálogos de Ação */}
      <GameActionsSheet
        game={actionGame}
        running={actionGame ? runningIds.has(actionGame.id) : false}
        pcOnline={pcStatus.online}
        onClose={() => setActionGame(null)}
        onLaunch={launch}
        onFavorite={toggleFavorite}
        onEdit={handleOpenEdit}
        onAchievements={onOpenAchievements}
        onSoftClose={(g) => onSoftClose(g)}
        onForceClose={handleConfirmForceClose}
      />

      <EditGameSheet
        game={editingGame}
        saving={savingEdit}
        onClose={() => setEditingGame(null)}
        onSave={handleSaveEdit}
        onAchievements={onOpenAchievements}
      />

      <ConfirmDialog
        open={Boolean(forceKillTarget)}
        title="🛑 Forçar encerramento?"
        message={`Deseja forçar o encerramento do processo de "${forceKillTarget?.name}"? Dados não salvos no jogo podem ser perdidos.`}
        confirmLabel="Forçar encerramento"
        cancelLabel="Cancelar"
        tone="danger"
        onConfirm={() => {
          const target = forceKillTarget;
          setForceKillTarget(null);
          close({ force: true, target });
        }}
        onCancel={() => setForceKillTarget(null)}
      />
    </div>
  );
}
