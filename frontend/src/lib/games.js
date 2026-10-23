export const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "fav", label: "Favoritos" },
  { id: "steam", label: "Steam" },
  { id: "local", label: "Local" },
];

export const SORTS = [
  { id: "default", label: "Favoritos primeiro" },
  { id: "recent", label: "Mais recentes" },
  { id: "playtime", label: "Mais jogados" },
  { id: "az", label: "Nome (A–Z)" },
];

/** Steam = atalho de internet da Steam (.url). Todo o resto é jogo local (.lnk ou .exe). */
export function getPlatform(game) {
  return game?.extension === ".url" ? "steam" : "local";
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
const timeOf = (iso) => (iso ? new Date(iso).getTime() : 0);

export function filterAndSortGames(games, { search, filter, sortBy }) {
  const term = search.trim().toLowerCase();

  const result = games.filter((game) => {
    if (term && !game.name.toLowerCase().includes(term)) return false;
    if (filter === "fav") return Boolean(game.favorite);
    if (filter === "steam") return getPlatform(game) === "steam";
    if (filter === "local") return getPlatform(game) === "local";
    return true;
  });

  return result.sort((a, b) => {
    if (sortBy === "recent") return timeOf(b.lastPlayed) - timeOf(a.lastPlayed);
    if (sortBy === "playtime") return (b.playTime || 0) - (a.playTime || 0);
    if (sortBy === "az") return collator.compare(a.name, b.name);
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

export function countByFilter(games) {
  return {
    all: games.length,
    fav: games.filter((g) => g.favorite).length,
    steam: games.filter((g) => getPlatform(g) === "steam").length,
    local: games.filter((g) => getPlatform(g) === "local").length,
  };
}

export function getRecentGames(games, limit = 8) {
  return games
    .filter((g) => g.lastPlayed)
    .sort((a, b) => timeOf(b.lastPlayed) - timeOf(a.lastPlayed))
    .slice(0, limit);
}
