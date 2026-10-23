import { http } from "./client";

export const gamesApi = {
  list: () => http.get("/games").then((r) => r.data),
  rescan: () => http.post("/refresh").then((r) => r.data),
  toggleFavorite: (id) => http.post(`/games/${id}/favorite`).then((r) => r.data),
  searchCovers: (id, query) =>
    http.get(`/games/${id}/covers`, { params: { query } }).then((r) => r.data?.covers || []),
  update: (id, payload) => http.put(`/games/${id}`, payload).then((r) => r.data),

  play: (id) => http.post("/play", { id }).then((r) => r.data),
  getActive: () => http.get("/system/active-game").then((r) => r.data),
  close: (payload) => http.post("/system/close-game", payload).then((r) => r.data),
  clearActive: (id) => http.post("/system/clear-active", id ? { id } : {}).then((r) => r.data),
};
