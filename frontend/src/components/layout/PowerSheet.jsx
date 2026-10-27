import { useState } from "react";
import { Moon, Power, RotateCcw, ShieldX } from "lucide-react";
import Sheet from "../ui/Sheet";
import { haptic } from "../../lib/haptics";

const ACTIONS = {
  sleep: { label: "Suspender", hint: "Economiza energia e acorda com Wake-on-LAN", Icon: Moon, tone: "warning" },
  restart: { label: "Reiniciar", hint: "Fecha tudo e reinicia o Windows", Icon: RotateCcw, tone: "warning" },
  shutdown: { label: "Desligar", hint: "Encerra o Windows por completo", Icon: Power, tone: "danger" },
};

function confirmText(action, timerSec) {
  if (action === "sleep") return "O computador entrará em modo de suspensão agora.";
  const verb = action === "restart" ? "reiniciado" : "desligado";
  return `O computador será ${verb} em ${timerSec} segundos. Você poderá cancelar.`;
}

/** Folha de energia em duas etapas (escolher → confirmar) para evitar toques acidentais. */
export default function PowerSheet({ open, onClose, shutdownScheduled, timerSec, busy, onRun }) {
  const [pending, setPending] = useState(null);
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setPending(null);
    }
  }

  const run = async (action) => {
    const ok = await onRun(action);
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Energia do PC">
      {shutdownScheduled && (
        <button type="button" className="power-cancel" onClick={() => run("cancel")} disabled={busy}>
          <ShieldX size={20} />
          <span>
            <strong>Cancelar desligamento</strong>
            <small>Há uma ação de energia programada</small>
          </span>
        </button>
      )}

      {!pending ? (
        <div className="power-list">
          {Object.entries(ACTIONS).map(([id, { label, hint, Icon, tone }]) => (
            <button
              key={id}
              type="button"
              className={`power-item power-item--${tone}`}
              onClick={() => {
                haptic.select();
                setPending(id);
              }}
            >
              <span className="power-item__icon">
                <Icon size={22} />
              </span>
              <span className="power-item__text">
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="power-confirm">
          <h3>{ACTIONS[pending].label} o PC?</h3>
          <p>{confirmText(pending, timerSec)}</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                haptic.tap();
                setPending(null);
              }}
            >
              Voltar
            </button>
            <button
              type="button"
              className={`btn ${ACTIONS[pending].tone === "danger" ? "btn-danger" : "btn-primary"}`}
              onClick={() => run(pending)}
              disabled={busy}
            >
              Confirmar
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
