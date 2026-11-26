"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, STORAGE_KEYS } from "./api";

export type Role =
  | "CUSTOMER"
  | "SELLER"
  | "WAREHOUSE_OPERATOR"
  | "SUPPORT_AGENT"
  | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  sellerId?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.user);
    if (raw) {
      try {
        setUser(JSON.parse(raw) as AuthUser);
      } catch {
        localStorage.removeItem(STORAGE_KEYS.user);
      }
    }
    setReady(true);
  }, []);

  async function login(email: string, password: string): Promise<AuthUser> {
    const data = await apiFetch<{
      accessToken: string;
      refreshToken: string;
      user: AuthUser;
    }>(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
      false
    );

    localStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  async function logout(): Promise<void> {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
    if (refreshToken) {
      await apiFetch(
        "/api/v1/auth/logout",
        {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        },
        false
      ).catch(() => {});
    }
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    localStorage.removeItem(STORAGE_KEYS.user);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
