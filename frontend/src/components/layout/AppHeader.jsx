import { RefreshCw } from "lucide-react";
import { SERVER_HOST } from "../../api";
import WakeButton from "./WakeButton";

const STATUS_TEXT = {
  checking: "Conectando…",
  online: "Online",
  offline: "Offline",
};

const WS_STATE_TEXT = {
  CONNECTING: "Conectando…",
  CONNECTED: "Online",
  DISCONNECTED: "Offline",
};

export default function AppHeader({ pc, onRefresh, refreshing }) {
  const host = pc.info?.serverIp || SERVER_HOST;
  const stateLabel = WS_STATE_TEXT[pc.connectionState] || STATUS_TEXT[pc.status] || "Conectando…";

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <img src="/gamepad.svg" alt="" className="app-header__logo" width="28" height="28" />
        <div className="app-header__text">
          <div className="app-header__title-row">
            <h1 className="app-header__title">GameLauncher</h1>
            <span className="app-header__version">v1.4.0</span>
          </div>
          <p
            className={`status-pill status-pill--${pc.status}`}
            data-ws-state={pc.connectionState}
            aria-live="polite"
          >
            <span className="status-pill__dot" aria-hidden="true" />
            <span className="status-pill__state">{stateLabel}</span>
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
            <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
          </button>
        )}
        <WakeButton online={pc.online} wakeState={pc.wakeState} onWake={pc.wake} />
      </div>
    </header>
  );
}
