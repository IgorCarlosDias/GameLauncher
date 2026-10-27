/**
 * Dispara feedback tátil (vibração nativa) via Web Vibration API (`navigator.vibrate`).
 * Possui fallback silencioso caso o dispositivo ou navegador não suporte a API.
 *
 * @param {number | number[]} [pattern=15] Duração em ms ou padrão de pulsos [vibra, pausa, vibra].
 * @returns {boolean} `true` se o comando foi aceito pelo dispositivo, `false` caso contrário.
 */
export function vibrate(pattern = 15) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  try {
    return navigator.vibrate(pattern);
  } catch {
    // Dispositivos ou plataformas sem suporte a vibração ignoram silenciosamente.
    return false;
  }
}

/**
 * Feedback tátil (haptics) calibrado para resposta física nítida em smartphones.
 * - tick: micropulso para sliders (12ms)
 * - tap: clique rápido e limpo para teclas, D-pad, scroll e mouse (15ms)
 * - select: toque firme para troca de abas, mute e seleções (25ms)
 * - confirm: confirmação sólida para envios, iniciar jogo e Wake-on-LAN (40ms)
 * - double: duplo pulso para duplo clique ([18, 35, 22]ms)
 * - success: padrão de sucesso ([20, 40, 30]ms)
 * - warn: padrão de alerta ([30, 40, 30]ms)
 * - heavy: impacto forte para ações críticas como Alt+F4 / Desligar ([45, 30, 55]ms)
 */
export const haptic = Object.assign((pattern = 15) => vibrate(pattern), {
  vibrate,
  tick: () => vibrate(12),
  tap: () => vibrate(15),
  select: () => vibrate(25),
  confirm: () => vibrate(40),
  double: () => vibrate([18, 35, 22]),
  success: () => vibrate([20, 40, 30]),
  warn: () => vibrate([30, 40, 30]),
  heavy: () => vibrate([45, 30, 55]),
});

export default vibrate;
