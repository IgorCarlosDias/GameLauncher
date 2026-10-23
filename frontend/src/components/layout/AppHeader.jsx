import { RefreshCw } from "lucide-react";
import { SERVER_HOST } from "../../api";
import WakeButton from "./WakeButton";

const STATUS_TEXT = {
  checking: "Verificando…",
  online: "Online",
  offline: "Offline",
};

export default function AppHeader({ pc, onRefresh, refreshing }) {
  const host = pc.info?.serverIp || SERVER_HOST;

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <img src="/gamepad.svg" alt="" className="app-header__logo" width="38" height="38" />
        <div className="app-header__text">
          <h1 className="app-header__title">GameLauncher</h1>
          <p className={`status-pill status-pill--${pc.status}`} aria-live="polite">
            <span className="status-pill__dot" aria-hidden="true" />
            <span className="status-pill__state">{STATUS_TEXT[pc.status]}</span>
            <span className="status-pill__host">{host}</span>
          </p>
        </div>
      </div>

      <div className="app-header__actions">
        {onRefresh && (
          <button
            type="button"
            className="icon-btn"
            onClick={onRefresh}
            disabled={refreshing || !pc.online}
            aria-label="Atualizar biblioteca"
          >
            <RefreshCw size={19} className={refreshing ? "spin" : undefined} />
          </button>
        )}
        <WakeButton online={pc.online} wakeState={pc.wakeState} onWake={pc.wake} />
      </div>
    </header>
  );
}
