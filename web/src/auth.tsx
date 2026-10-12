import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { api } from "./api";
import type { User } from "./api";

interface AuthState {
  /** `undefined` while the first check runs, `null` when logged out. */
  user: User | null | undefined;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Knows who is logged in, for every page below it.
 *
 * It asks the server once on load; the session itself lives in an httpOnly
 * cookie the page cannot read, so the server is the only source of truth.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then((answer) => setUser(answer.user))
      .catch(() => setUser(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const answer = await api<{ user: User }>("/api/auth/login", { body: { email, password } });
    setUser(answer.user);
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

/** The auth state, for any page inside `AuthProvider`. */
export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth must be used inside AuthProvider.");
  return state;
}
