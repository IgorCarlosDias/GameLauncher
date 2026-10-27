import { AlertTriangle } from "lucide-react";
import { vibrate } from "../../lib/haptics";

export default function ShutdownBanner({ onCancel, busy }) {
  return (
    <div className="banner banner--warning" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>PC programado para desligar em instantes.</span>
      <button
        type="button"
        className="btn btn-sm btn-secondary"
        onClick={() => {
          vibrate(25);
          onCancel?.();
        }}
        disabled={busy}
      >
        Cancelar
      </button>
    </div>
  );
}
