import React from "react";
import { X, Rocket, CheckCircle2 } from "lucide-react";
import { useImageCache } from "../../hooks/useImageCache";

export default function SphericalNotification({ notification, isLeaving, onDismiss }) {
  const { src: coverSrc, onError: handleCoverError } = useImageCache(notification?.cover);

  if (!notification) return null;

  const isEnded = notification.kind === "ended";

  return (
    <div
      key={notification.key}
      className={`launch-notification-toast ${isEnded ? "is-ended" : "is-started"}${
        isLeaving ? " is-leaving" : ""
      }`}
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      <div className="launch-toast-card">
        <span className="launch-toast-orb" aria-hidden="true" />
        <div className="launch-toast-body">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={notification.name}
              className="launch-toast-thumb"
              loading="eager"
              onError={handleCoverError}
            />
          ) : (
            <div className="launch-toast-thumb placeholder">🎮</div>
          )}

          <div className="launch-toast-info">
            <div className="launch-toast-badge-row">
              <span className="launch-toast-badge">
                {isEnded ? (
                  <>
                    <CheckCircle2 size={12} className="launch-badge-icon" aria-hidden="true" />
                    <span>ENCERRADO</span>
                  </>
                ) : (
                  <>
                    <Rocket size={12} className="launch-badge-icon" aria-hidden="true" />
                    <span>INICIADO</span>
                  </>
                )}
              </span>
            </div>
            <strong className="launch-toast-title">{notification.name}</strong>
            <span className="launch-toast-playtime">
              {isEnded ? "Sessão: " : "Tempo jogado: "}
              <strong>{notification.detail}</strong>
            </span>
          </div>

          <button
            type="button"
            className="launch-toast-close"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            title="Fechar notificação"
            aria-label="Fechar notificação"
          >
            <X size={16} />
          </button>
        </div>
        <div className="launch-toast-timer-bar" />
      </div>
    </div>
  );
}
