import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, api } from "../api.js";

interface AuthState {
  loading: boolean;
  /** True until the single account exists. Forces the setup screen. */
  needsSetup: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { needsSetup: needs } = await api.setupStatus();
      setNeedsSetup(needs);
      if (needs) {
        setUsername(null);
        return;
      }
      try {
        const { username: name } = await api.me();
        setUsername(name);
      } catch (err) {
        // 401 is the ordinary signed-out case, not a failure worth surfacing.
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        setUsername(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (name: string, password: string) => {
    const { username: signedIn } = await api.login(name, password);
    setUsername(signedIn);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUsername(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ loading, needsSetup, username, login, logout, refresh }),
    [loading, needsSetup, username, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
