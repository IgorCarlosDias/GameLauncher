import { useElapsedSeconds } from "../../hooks/useElapsedSeconds";
import { formatPlayTimeDetailed, formatTimer } from "../../lib/format";

/**
 * Duração que se atualiza sozinha a cada segundo — só este nó re-renderiza.
 * `variant="clock"` → 01:23:45 · `variant="human"` → 1h 23m (somando `baseSeconds`).
 */
export default function LiveDuration({ startedAt, baseSeconds = 0, variant = "clock" }) {
  const elapsed = useElapsedSeconds(startedAt);
  if (variant === "human") return <>{formatPlayTimeDetailed(baseSeconds + elapsed)}</>;
  return <>{formatTimer(baseSeconds + elapsed)}</>;
}
