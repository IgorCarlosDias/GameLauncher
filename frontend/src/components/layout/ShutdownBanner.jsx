import { AlertTriangle } from "lucide-react";

export default function ShutdownBanner({ onCancel, busy }) {
  return (
    <div className="banner banner--warning" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>PC programado para desligar em instantes.</span>
      <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}>
        Cancelar
      </button>
    </div>
  );
}
