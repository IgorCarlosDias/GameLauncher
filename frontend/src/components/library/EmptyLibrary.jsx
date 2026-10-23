import React from "react";
import { Gamepad2, SearchX, RefreshCw } from "lucide-react";

export default function EmptyLibrary({ hasFilter, onClearFilter, onRescan, refreshing }) {
  return (
    <div className="empty-library-state">
      <div className="empty-library-icon">
        {hasFilter ? <SearchX size={44} /> : <Gamepad2 size={44} />}
      </div>
      <h3 className="empty-library-title">
        {hasFilter ? "Nenhum jogo encontrado" : "Nenhum jogo na biblioteca"}
      </h3>
      <p className="empty-library-desc">
        {hasFilter
          ? "Tente buscar por outro termo ou remova os filtros ativos."
          : "Verifique a pasta configurada nas opções ou atualize o escaneamento."}
      </p>

      <div className="empty-library-actions">
        {hasFilter && (
          <button type="button" className="btn btn-secondary" onClick={onClearFilter}>
            Limpar Busca e Filtros
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRescan}
          disabled={refreshing}
        >
          <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
          <span>{refreshing ? "Escaneando..." : "Escanear Pasta"}</span>
        </button>
      </div>
    </div>
  );
}
