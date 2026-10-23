import { useRef, useState } from "react";
import { haptic } from "../lib/haptics";

/**
 * Toque curto = `onPress` (via click, então rolar a lista nunca dispara).
 * Toque longo = `onLongPress`, com vibração e sem disparar o `onPress` ao soltar.
 */
export function useLongPress({ onPress, onLongPress, delay = 450, tolerance = 10 }) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef(null);
  const originRef = useRef({ x: 0, y: 0 });
  const firedRef = useRef(false);

  const cancel = () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  };

  const handlers = {
    onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      firedRef.current = false;
      originRef.current = { x: e.clientX, y: e.clientY };
      setHolding(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        setHolding(false);
        haptic.select();
        onLongPress?.();
      }, delay);
    },
    onPointerMove(e) {
      if (!timerRef.current) return;
      const dx = e.clientX - originRef.current.x;
      const dy = e.clientY - originRef.current.y;
      if (dx * dx + dy * dy > tolerance * tolerance) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClick(e) {
      if (firedRef.current) {
        firedRef.current = false;
        e.preventDefault();
        return;
      }
      onPress?.(e);
    },
    onContextMenu(e) {
      e.preventDefault();
    },
  };

  return { holding, handlers };
}
