import React, { useRef, useEffect } from "react";
import { systemApi } from "../../api";
import { haptic } from "../../lib/haptics";

export default function TouchpadCanvas({ sensitivity = 2.1 }) {
  const canvasRef = useRef(null);
  const touchStateRef = useRef({
    lastX: 0,
    lastY: 0,
    startTime: 0,
    lastTouchTime: 0,
    moved: false,
    accumX: 0,
    accumY: 0,
    sending: false,
    isTouching: false,
    mouseDown: false,
    currentLocalX: 0,
    currentLocalY: 0,
    points: [],
    ripples: [],
    animFrameId: null,
  });

  function flushTouchpadMove() {
    if (touchStateRef.current.sending) return;
    const sendX = Math.round(touchStateRef.current.accumX);
    const sendY = Math.round(touchStateRef.current.accumY);
    if (sendX === 0 && sendY === 0) return;

    touchStateRef.current.accumX = 0;
    touchStateRef.current.accumY = 0;
    touchStateRef.current.sending = true;

    systemApi
      .mouseMove(sendX, sendY)
      .catch(() => {})
      .finally(() => {
        touchStateRef.current.sending = false;
        if (
          Math.abs(touchStateRef.current.accumX) >= 1 ||
          Math.abs(touchStateRef.current.accumY) >= 1
        ) {
          flushTouchpadMove();
        }
      });
  }

  function startTrailAnimation() {
    if (touchStateRef.current.animFrameId) return;

    const renderFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        touchStateRef.current.animFrameId = null;
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const now = performance.now();
      const trailLifetime = 380;
      const rippleLifetime = 420;

      const state = touchStateRef.current;
      state.points = state.points.filter((p) => now - p.time < trailLifetime);
      state.ripples = state.ripples.filter((r) => now - r.time < rippleLifetime);

      // Ondas de clique (ripples)
      for (const r of state.ripples) {
        const progress = (now - r.time) / rippleLifetime;
        const radius = 6 + progress * 32;
        const alpha = (1 - progress) * 0.7;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(139, 92, 246, ${alpha})`;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }

      // Rastro neon contínuo (traço cometa acelerado)
      const pts = state.points;
      if (pts.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          const age = (now - curr.time) / trailLifetime;
          const life = Math.max(0, 1 - age);

          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);

          // Glow neon externo
          ctx.shadowColor = "rgba(139, 92, 246, 0.9)";
          ctx.shadowBlur = 14 * life;
          ctx.strokeStyle = `rgba(139, 92, 246, ${life * 0.85})`;
          ctx.lineWidth = Math.max(1.8, 8 * life);
          ctx.stroke();

          // Núcleo ciano brilhante
          ctx.shadowBlur = 0;
          ctx.strokeStyle = `rgba(196, 181, 253, ${life * 0.95})`;
          ctx.lineWidth = Math.max(0.8, 2.8 * life);
          ctx.stroke();
        }
      }

      // Halo pulsante sob o dedo
      if (state.isTouching) {
        const grad = ctx.createRadialGradient(
          state.currentLocalX,
          state.currentLocalY,
          2,
          state.currentLocalX,
          state.currentLocalY,
          24
        );
        grad.addColorStop(0, "rgba(224, 231, 255, 0.95)");
        grad.addColorStop(0.4, "rgba(139, 92, 246, 0.55)");
        grad.addColorStop(1, "rgba(59, 130, 246, 0)");

        ctx.beginPath();
        ctx.arc(state.currentLocalX, state.currentLocalY, 24, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.restore();

      if (state.isTouching || state.points.length > 0 || state.ripples.length > 0) {
        state.animFrameId = requestAnimationFrame(renderFrame);
      } else {
        state.animFrameId = null;
      }
    };

    touchStateRef.current.animFrameId = requestAnimationFrame(renderFrame);
  }

  function recordTrailPoint(clientX, clientY, addRipple = false) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const now = performance.now();

    touchStateRef.current.currentLocalX = x;
    touchStateRef.current.currentLocalY = y;
    touchStateRef.current.points.push({ x, y, time: now });
    if (touchStateRef.current.points.length > 45) {
      touchStateRef.current.points.shift();
    }
    if (addRipple) {
      touchStateRef.current.ripples.push({ x, y, time: now });
    }
    startTrailAnimation();
  }

  function handleTouchStart(e) {
    touchStateRef.current.lastTouchTime = Date.now();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStateRef.current.lastX = t.clientX;
      touchStateRef.current.lastY = t.clientY;
      touchStateRef.current.startTime = Date.now();
      touchStateRef.current.moved = false;
      touchStateRef.current.isTouching = true;
      recordTrailPoint(t.clientX, t.clientY, true);
    } else if (e.touches.length === 2) {
      touchStateRef.current.moved = true;
    }
  }

  function handleTouchMove(e) {
    touchStateRef.current.lastTouchTime = Date.now();
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    recordTrailPoint(t.clientX, t.clientY, false);

    const sens = Number(sensitivity) || 2.1;
    const dx = (t.clientX - touchStateRef.current.lastX) * sens;
    const dy = (t.clientY - touchStateRef.current.lastY) * sens;
    touchStateRef.current.lastX = t.clientX;
    touchStateRef.current.lastY = t.clientY;

    if (Math.abs(dx) > 1.2 || Math.abs(dy) > 1.2) {
      touchStateRef.current.moved = true;
    }

    touchStateRef.current.accumX += dx;
    touchStateRef.current.accumY += dy;

    if (
      Math.abs(touchStateRef.current.accumX) >= 2 ||
      Math.abs(touchStateRef.current.accumY) >= 2
    ) {
      flushTouchpadMove();
    }
  }

  function handleTouchEnd() {
    touchStateRef.current.lastTouchTime = Date.now();
    touchStateRef.current.isTouching = false;
    startTrailAnimation();
    flushTouchpadMove();
    const elapsed = Date.now() - touchStateRef.current.startTime;
    if (!touchStateRef.current.moved && elapsed < 260) {
      touchStateRef.current.ripples.push({
        x: touchStateRef.current.currentLocalX,
        y: touchStateRef.current.currentLocalY,
        time: performance.now(),
      });
      startTrailAnimation();
      haptic.tap();
      systemApi.mouseClick("left").catch(() => {});
    }
  }

  // Mouse emulation for desktop testing
  function handleMouseDown(e) {
    if (Date.now() - touchStateRef.current.lastTouchTime < 800) return;
    touchStateRef.current.mouseDown = true;
    touchStateRef.current.isTouching = true;
    touchStateRef.current.lastX = e.clientX;
    touchStateRef.current.lastY = e.clientY;
    touchStateRef.current.moved = false;
    recordTrailPoint(e.clientX, e.clientY, true);
  }

  function handleMouseMove(e) {
    if (!touchStateRef.current.mouseDown) return;
    recordTrailPoint(e.clientX, e.clientY, false);
    const sens = Number(sensitivity) || 2.1;
    const dx = (e.clientX - touchStateRef.current.lastX) * sens;
    const dy = (e.clientY - touchStateRef.current.lastY) * sens;
    touchStateRef.current.lastX = e.clientX;
    touchStateRef.current.lastY = e.clientY;

    if (Math.abs(dx) > 1.2 || Math.abs(dy) > 1.2) {
      touchStateRef.current.moved = true;
    }

    touchStateRef.current.accumX += dx;
    touchStateRef.current.accumY += dy;

    if (
      Math.abs(touchStateRef.current.accumX) >= 2 ||
      Math.abs(touchStateRef.current.accumY) >= 2
    ) {
      flushTouchpadMove();
    }
  }

  function handleMouseUp() {
    if (!touchStateRef.current.mouseDown) return;
    touchStateRef.current.mouseDown = false;
    touchStateRef.current.isTouching = false;
    startTrailAnimation();
    flushTouchpadMove();
  }

  function handleClick(e) {
    if (Date.now() - touchStateRef.current.lastTouchTime < 800) return;
    if (touchStateRef.current.moved) return;
    recordTrailPoint(e.clientX, e.clientY, true);
    haptic.tap();
    systemApi.mouseClick("left").catch(() => {});
  }

  useEffect(() => {
    const touchState = touchStateRef.current;
    return () => {
      if (touchState.animFrameId) {
        cancelAnimationFrame(touchState.animFrameId);
      }
    };
  }, []);

  return (
    <div
      className="touchpad-surface"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="touchpad-canvas" />
      <div className="touchpad-watermark" aria-hidden="true">
        <span>Deslize para mover o cursor</span>
        <small>Toque curto para clicar</small>
      </div>
    </div>
  );
}
