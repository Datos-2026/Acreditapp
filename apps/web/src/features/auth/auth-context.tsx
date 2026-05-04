import { createContext, useContext, useState } from "react";
import type { PropsWithChildren } from "react";
import type { AuthUser } from "@gcba/shared";
import { api, setAccessToken } from "../../lib/api";

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setToken] = useState<string | null>(null);

  const refreshMe = async () => {
    try {
      if (!accessToken) {
        const refreshResponse = await api.post("/auth/refresh");
        setToken(refreshResponse.data.accessToken);
        setAccessToken(refreshResponse.data.accessToken);
      }
      const me = await api.get<AuthUser>("/auth/me");
      setUser(me.data);
    } catch {
      setUser(null);
      setToken(null);
      setAccessToken(null);
    }
  };

  const login = async (email: string, password: string) => {
    const response = await api.post<{ accessToken: string }>("/auth/login", { email, password });
    setToken(response.data.accessToken);
    setAccessToken(response.data.accessToken);
    const me = await api.get<AuthUser>("/auth/me");
    setUser(me.data);
    return me.data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setToken(null);
      setUser(null);
      setAccessToken(null);
    }
  };

  const value = {
    user,
    accessToken,
    login,
    logout,
    refreshMe
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider faltante");
  return ctx;
}
