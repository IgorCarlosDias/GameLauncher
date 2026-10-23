import { useEffect, useState } from "react";

/** Contador em segundos desde `startedAt`; só agenda timer enquanto houver sessão. */
export function useElapsedSeconds(startedAt) {
  const compute = () =>
    startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) : 0;
  const [seconds, setSeconds] = useState(compute);
  const [prevStartedAt, setPrevStartedAt] = useState(startedAt);

  if (prevStartedAt !== startedAt) {
    setPrevStartedAt(startedAt);
    setSeconds(compute());
  }

  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return seconds;
}
