import { useCallback, useEffect, useState } from "react";

const PAGES = ["library", "remote", "stats", "settings"];

function parseHash() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const [name, query = ""] = hash.split("?");
  const page = PAGES.includes(name) ? name : "library";
  const tab = new URLSearchParams(query).get("tab") || "steam";
  return { page, settingsTab: tab };
}

/** Roteamento por hash (#library, #remote, #stats, #settings?tab=steam). */
export function useRoute() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const sync = () => setRoute(parseHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((page, { tab } = {}) => {
    const hash = page === "library" ? "" : `#${page}${tab ? `?tab=${tab}` : ""}`;
    // replaceState evita empilhar histórico a cada troca de aba (voltar do Android fecha o app).
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    setRoute({ page, settingsTab: tab || "steam" });
  }, []);

  return { ...route, navigate };
}
