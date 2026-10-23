function vibrate(pattern) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Plataformas sem suporte a vibração ignoram silenciosamente.
  }
}

/** Feedback tátil. `haptic(ms)` mantém compatibilidade com o antigo `triggerHaptic`. */
export const haptic = Object.assign((ms = 20) => vibrate(ms), {
  tap: () => vibrate(12),
  select: () => vibrate(18),
  confirm: () => vibrate(35),
  success: () => vibrate([18, 40, 28]),
  warn: () => vibrate([30, 50, 30]),
  heavy: () => vibrate(50),
});
