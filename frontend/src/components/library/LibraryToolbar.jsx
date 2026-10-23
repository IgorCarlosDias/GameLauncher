import { ArrowUpDown, LayoutGrid, List, Search, X } from "lucide-react";
import { FILTERS, SORTS } from "../../lib/games";
import { haptic } from "../../lib/haptics";

/** Busca + chips de plataforma + ordenação + modo de visualização (fixo no topo da lista). */
export default function LibraryToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  counts,
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
    </div>
  );
}
