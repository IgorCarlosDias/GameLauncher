import { createPortal } from "react-dom";
import { useDelayedUnmount } from "../../hooks/useDelayedUnmount";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { vibrate } from "../../lib/haptics";

/** Confirmação centralizada. `tone="danger"` pinta a ação principal de vermelho. */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}) {
  const mounted = useDelayedUnmount(open, 180);
  useEscapeKey(open, onCancel);

  if (!mounted) return null;

  return createPortal(
    <div className={`modal-backdrop modal-backdrop--center${open ? "" : " is-closing"}`} onClick={onCancel}>
      <div
        className="modal-dialog dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog__title">{title}</h3>
        {message && <p className="dialog__message">{message}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              vibrate(15);
              onCancel?.();
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={() => {
              vibrate(tone === "danger" ? [45, 30, 55] : 25);
              onConfirm?.();
            }}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
