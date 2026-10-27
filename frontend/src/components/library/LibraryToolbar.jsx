import { ArrowUpDown, LayoutGrid, List, Search, Tag, X } from "lucide-react";
import { FILTERS, SORTS } from "../../lib/games";
import { haptic } from "../../lib/haptics";

/** Busca + chips de plataforma + chips de gênero + ordenação + modo de visualização (fixo no topo da lista). */
export default function LibraryToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  counts,
  genre = "all",
  onGenre,
  genres = [],
  sortBy,
  onSort,
  viewMode,
  onViewMode,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <label className="search">
          <Search size={18} className="search__icon" aria-hidden="true" />
          <input
            type="search"
            className="search__input"
            placeholder="Buscar na biblioteca"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {search && (
            <button
              type="button"
              className="search__clear"
              onClick={() => {
                haptic.tap();
                onSearch("");
              }}
              aria-label="Limpar busca"
            >
              <X size={16} />
            </button>
          )}
        </label>

        <div className="view-toggle" role="group" aria-label="Modo de visualização">
          <button
            type="button"
            className={`view-toggle__btn${viewMode === "grid" ? " is-active" : ""}`}
            onClick={() => {
              haptic.tap();
              onViewMode("grid");
            }}
            aria-label="Grade"
            aria-pressed={viewMode === "grid"}
          >
            <LayoutGrid size={18} />
          </button>
          <button
            type="button"
            className={`view-toggle__btn${viewMode === "list" ? " is-active" : ""}`}
            onClick={() => {
              haptic.tap();
              onViewMode("list");
            }}
            aria-label="Lista"
            aria-pressed={viewMode === "list"}
          >
            <List size={18} />
          </button>
        </div>
      </div>

      <div className="toolbar__row toolbar__row--chips">
        <div className="chips" role="group" aria-label="Filtrar por">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`chip${filter === id ? " is-active" : ""}`}
              onClick={() => {
                haptic.tap();
                onFilter(id);
              }}
              aria-pressed={filter === id}
            >
              {label}
              <span className="chip__count">{counts[id]}</span>
            </button>
          ))}
        </div>

        <label className="sort" title="Ordenar">
          <ArrowUpDown size={16} aria-hidden="true" />
          <select value={sortBy} onChange={(e) => onSort(e.target.value)} aria-label="Ordenar biblioteca">
            {SORTS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {genres.length > 0 && onGenre && (
        <div className="toolbar__row toolbar__row--genres">
          <div className="chips chips--genres" role="group" aria-label="Filtrar por gênero">
            <button
              type="button"
              className={`chip chip--genre${genre === "all" ? " is-active" : ""}`}
              onClick={() => {
                haptic.tap();
                onGenre("all");
              }}
              aria-pressed={genre === "all"}
            >
              <Tag size={12} aria-hidden="true" />
              Todos os gêneros
            </button>
            {genres.map(({ id, label, count }) => (
              <button
                key={id}
                type="button"
                className={`chip chip--genre${genre === id ? " is-active" : ""}`}
                onClick={() => {
                  haptic.tap();
                  onGenre(genre === id ? "all" : id);
                }}
                aria-pressed={genre === id}
              >
                {label}
                <span className="chip__count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
