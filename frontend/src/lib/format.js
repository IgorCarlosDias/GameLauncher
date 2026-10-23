/** HH:MM:SS (ou MM:SS) para cronômetros. */
export function formatTimer(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hrs > 0 ? `${String(hrs).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "12h 30m" / "45m". Retorna null abaixo de 1 minuto. */
export function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return null;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  return `${mins}m`;
}

/** Versão para listas: nunca retorna vazio. */
export function formatPlayTimeDetailed(seconds) {
  if (!seconds || seconds <= 0) return "0m";
  return formatPlayTime(seconds) || "<1m";
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Segundos decorridos desde `startedAt` (ISO). */
export function secondsSince(startedAt, now = Date.now()) {
  if (!startedAt) return 0;
  const diff = Math.floor((now - new Date(startedAt).getTime()) / 1000);
  return diff > 0 ? diff : 0;
}
