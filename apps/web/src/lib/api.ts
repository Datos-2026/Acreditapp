import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

/** Por defecto `/api/v1`: mismo origen en prod (Express) y en dev (proxy de Vite → puerto 4000). */
const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true
});

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = api
      .post<{ accessToken: string }>("/auth/refresh")
      .then((res) => {
        const token = res.data.accessToken;
        setAccessToken(token);
        return token;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;
    const status = error.response?.status;
    const isAuthRoute = config?.url?.includes("/auth/login") || config?.url?.includes("/auth/refresh");

    if (status === 401 && config && !config._retry && !isAuthRoute) {
      config._retry = true;
      const token = await refreshAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      }
    }

    return Promise.reject(error);
  }
);

export function setAccessToken(token: string | null): void {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
}
