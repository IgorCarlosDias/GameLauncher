import { http, wakeHttp } from "./client";

const data = (r) => r.data;

export const systemApi = {
  /** Ping leve e sem autenticação (GET /). Timeout curto para detectar PC offline rápido. */
  ping: () => http.get("/", { timeout: 3500 }).then(data),
  /** Envia o magic packet via relay (ou API principal). */
  wake: () => wakeHttp.post("/system/wake").then(data),

  getStats: () => http.get("/system/stats").then(data),
  getAudio: () => http.get("/system/audio").then(data),
  getDisplay: () => http.get("/system/display").then(data),

  setVolume: (value) => http.post("/system/volume", { action: "set", value }).then(data),
  stepVolume: (action) => http.post("/system/volume", { action }).then(data),
  toggleMute: () => http.post("/system/volume", { action: "mute" }).then(data),
  setAudioDevice: (deviceId) => http.post("/system/audio/device", { deviceId }).then(data),
  setDisplay: (mode) => http.post("/system/display", { mode }).then(data),

  media: (action) => http.post("/system/media", { action }).then(data),
  key: (key) => http.post("/system/key", { key }).then(data),
  typeText: (text, submitEnter = false) =>
    http.post("/system/keyboard", { text, submitEnter }).then(data),

  mouseMove: (dx, dy) => http.post("/system/mouse", { action: "move", dx, dy }),
  mouseClick: (button = "left") => http.post("/system/mouse", { action: "click", button }),
  mouseScroll: (delta) => http.post("/system/mouse", { action: "scroll", delta }),

  power: (action) => http.post("/system/power", { action }).then(data),
};
