import { http } from "./client";

const data = (r) => r.data;

export const timesApi = {
  summary: () => http.get("/times").then(data),
  exportAll: () => http.get("/times/export").then(data),
  importData: (payload, mode) => http.post("/times/import", { data: payload, mode }).then(data),
  reloadLocal: (mode) => http.post("/times/reload-local", { mode }).then(data),
  cloudPush: () => http.post("/supabase/push").then(data),
};
