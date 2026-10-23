import { http } from "./client";

export const settingsApi = {
  get: () => http.get("/settings").then((r) => r.data),
};
