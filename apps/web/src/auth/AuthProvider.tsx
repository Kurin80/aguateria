import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, clearTokens, getAccessToken, setTokens } from "../api/client";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  companyId: string;
  permissions: string[];
  roles: string[];
};

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ data: SessionUser }>("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (identifier, password) => {
        const r = await api<{
          data: { accessToken: string; refreshToken: string; user: SessionUser };
        }>("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) });
        setTokens(r.data.accessToken, r.data.refreshToken);
        const me = await api<{ data: SessionUser }>("/auth/me");
        setUser(me.data);
      },
      logout: async () => {
        try {
          await api("/auth/logout", { method: "POST" });
        } finally {
          clearTokens();
          setUser(null);
        }
      },
      can: (permission) => Boolean(user?.permissions.includes(permission)),
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
