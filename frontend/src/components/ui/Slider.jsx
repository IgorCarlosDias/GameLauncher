import { useEffect, useRef } from "react";
import { haptic } from "../../lib/haptics";

const THUMB = 26;

/**
 * Slider por Pointer Events. Preenchimento (scaleX) e thumb (translate3d) usam apenas
 * `transform`, então o arrasto roda no compositor sem layout/paint por frame.
 */
export default function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  label,
  className = "",
}) {
  const rootRef = useRef(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));

  // Largura útil do trilho (sem o thumb) exposta como CSS var para posicionar via transform.
  useEffect(() => {
    const track = trackRef.current;
    const root = rootRef.current;
    if (!track || !root || typeof ResizeObserver === "undefined") return undefined;
    const update = () => root.style.setProperty("--rail", `${Math.max(0, track.clientWidth - THUMB)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  const valueFromPointer = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (e.clientX - rect.left - THUMB / 2) / (rect.width - THUMB)));
    const raw = min + r * (max - min);
    return Math.round(raw / step) * step;
  };

  const onPointerDown = (e) => {
    if (disabled) return;
    draggingRef.current = true;
    rootRef.current.setPointerCapture(e.pointerId);
    rootRef.current.dataset.dragging = "true";
    haptic(8);
    onChange(valueFromPointer(e));
  };

  const onPointerMove = (e) => {
    if (draggingRef.current) onChange(valueFromPointer(e));
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    delete rootRef.current.dataset.dragging;
    onCommit?.();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    const jump = e.shiftKey ? step * 10 : step;
    const keys = {
      ArrowRight: value + jump,
      ArrowUp: value + jump,
      ArrowLeft: value - jump,
      ArrowDown: value - jump,
      Home: min,
      End: max,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    onChange(Math.min(max, Math.max(min, keys[e.key])));
    onCommit?.();
  };

  return (
    <div
      ref={rootRef}
      className={`slider ${className}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div ref={trackRef} className="slider__track">
        <div className="slider__fill" style={{ transform: `scaleX(${ratio})` }} />
        <div className="slider__thumb" style={{ "--ratio": ratio }} />
      </div>
    </div>
  );
}
