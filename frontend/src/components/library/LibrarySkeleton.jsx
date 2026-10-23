import React from "react";

export default function LibrarySkeleton({ count = 6, viewMode = "grid" }) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (viewMode === "list") {
    return (
      <div className="skeleton-list-container" aria-busy="true" aria-label="Carregando jogos">
        {items.map((i) => (
          <div key={i} className="skeleton-row-card shimmer">
            <div className="skeleton-row-thumb" />
            <div className="skeleton-row-body">
              <div className="skeleton-line line-title" />
              <div className="skeleton-line line-meta" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="skeleton-grid-container" aria-busy="true" aria-label="Carregando jogos">
      {items.map((i) => (
        <div key={i} className="skeleton-poster-card shimmer">
          <div className="skeleton-poster-art" />
          <div className="skeleton-poster-footer">
            <div className="skeleton-line line-title" />
            <div className="skeleton-line line-meta" />
          </div>
        </div>
      ))}
    </div>
  );
}
