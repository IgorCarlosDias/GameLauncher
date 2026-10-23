import { useEffect } from "react";

/** Fecha com Esc (útil no desktop e em teclados Bluetooth). */
export function useEscapeKey(active, onEscape) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}
