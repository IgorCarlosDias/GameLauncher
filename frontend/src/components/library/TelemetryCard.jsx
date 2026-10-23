import { ChevronRight, Hourglass, Timer } from "lucide-react";
import LiveDuration from "../ui/LiveDuration";
import { formatPlayTimeDetailed } from "../../lib/format";

/**
 * Card compacto de telemetria: sessão atual (ao vivo) + total acumulado.
 * O total soma a sessão em curso, então os dois contadores andam juntos.
 */
export default function TelemetryCard({ session, totalSeconds, gamesCount, onOpen }) {
  const playing = Boolean(session);

  return (
    <button type="button" className="telemetry" onClick={onOpen} aria-label="Abrir detalhes de tempo de jogo">
      <div className="telemetry__cell">
        <span className="telemetry__label">
          <Timer size={14} aria-hidden="true" /> Sessão atual
        </span>
        <strong className={`telemetry__value telemetry__value--mono${playing ? " is-live" : ""}`}>
          {playing ? <LiveDuration startedAt={session.startedAt} /> : "--:--"}
        </strong>
        <span className="telemetry__sub">{playing ? session.name : "Nenhum jogo ativo"}</span>
      </div>

      <span className="telemetry__divider" aria-hidden="true" />

      <div className="telemetry__cell">
        <span className="telemetry__label">
          <Hourglass size={14} aria-hidden="true" /> Total acumulado
        </span>
        <strong className="telemetry__value">
          {playing ? (
            <LiveDuration variant="human" baseSeconds={totalSeconds} startedAt={session.startedAt} />
          ) : (
            formatPlayTimeDetailed(totalSeconds)
          )}
        </strong>
        <span className="telemetry__sub">
          {gamesCount} {gamesCount === 1 ? "jogo" : "jogos"}
        </span>
      </div>

      <ChevronRight size={18} className="telemetry__chevron" aria-hidden="true" />
    </button>
  );
}
