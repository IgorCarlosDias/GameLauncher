import { useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDelayedUnmount } from "../../hooks/useDelayedUnmount";
import { useEscapeKey } from "../../hooks/useEscapeKey";

const EXIT_MS = 220;
const DISMISS_DISTANCE = 100;

/**
 * Bottom sheet (mobile) / diálogo centralizado (telas largas).
 * Entra e sai com transform + opacity (≤ 220ms) e fecha arrastando para baixo pelo topo.
 */
export default function Sheet({ open, onClose, title, subtitle, children, footer, className = "" }) {
  const mounted = useDelayedUnmount(open, EXIT_MS);
  const dialogRef = useRef(null);
  const dragRef = useRef(null);

  useEscapeKey(open, onClose);

  if (!mounted) return null;

  const onDragStart = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { startY: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    dialogRef.current.style.transition = "none";
  };

  const onDragMove = (e) => {
    if (!dragRef.current) return;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    dragRef.current.dy = dy;
    dialogRef.current.style.transform = `translate3d(0, ${dy}px, 0)`;
  };

  const onDragEnd = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const dialog = dialogRef.current;
    dialog.style.transition = "";
    if (drag.dy > DISMISS_DISTANCE) {
      onClose();
    } else {
      dialog.style.transform = "";
    }
  };

  return createPortal(
    <div className={`modal-backdrop${open ? "" : " is-closing"}`} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`modal-dialog sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sheet__drag"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <span className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__header">
            <div className="sheet__titles">
              <h2 className="sheet__title">{title}</h2>
              {subtitle && <p className="sheet__subtitle">{subtitle}</p>}
            </div>
            <button
              type="button"
              className="icon-btn icon-btn--ghost"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
