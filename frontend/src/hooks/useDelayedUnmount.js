import { useEffect, useState } from "react";

/**
 * Mantém o componente montado durante a animação de saída.
 * Use: `const mounted = useDelayedUnmount(open, 220)`; `closing = mounted && !open`.
 */
export function useDelayedUnmount(open, ms = 220) {
  const [mounted, setMounted] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setMounted(true);
    }
  }

  useEffect(() => {
    if (open) return undefined;
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, ms]);

  return mounted || open;
}
