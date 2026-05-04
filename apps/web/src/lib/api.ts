import axios from "axios";

/** Por defecto `/api/v1`: mismo origen en prod (Express) y en dev (proxy de Vite → puerto 4000). */
const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true
});

export function setAccessToken(token: string | null): void {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
}
