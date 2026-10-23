import { AlertTriangle, CheckCircle2, Loader2, Power, Radio } from "lucide-react";

const VISUALS = {
  idle: { Icon: Power, label: "Ligar PC", busy: false },
  sending: { Icon: Loader2, label: "Enviando", busy: true },
  waiting: { Icon: Radio, label: "Aguardando", busy: true },
  success: { Icon: CheckCircle2, label: "Ligado!", busy: false },
  error: { Icon: AlertTriangle, label: "Falhou", busy: false },
};

/** Botão de Wake-on-LAN com feedback de envio → espera → sucesso/erro. */
export default function WakeButton({ online, wakeState, onWake }) {
  const visual = online && wakeState === "idle" ? { Icon: CheckCircle2, label: "Ligado", busy: false } : VISUALS[wakeState];
  const { Icon, label, busy } = visual;

  return (
    <button
      type="button"
      className={`wake-btn wake-btn--${wakeState}${online ? " is-online" : ""}`}
      onClick={onWake}
      disabled={busy}
      aria-busy={busy}
      aria-label={online ? "PC online" : "Ligar PC com Wake-on-LAN"}
    >
      <span className="wake-btn__icon">
        <Icon size={18} className={wakeState === "sending" ? "spin" : undefined} aria-hidden="true" />
      </span>
      <span className="wake-btn__label">{label}</span>
    </button>
  );
}
