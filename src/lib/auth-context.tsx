"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import type { User } from "./types";
import type { Locale } from "./i18n";

interface AuthContextValue {
  user: User | null;
  /** Null for super admins (they have everything); otherwise a module→actions map. */
  permissions: Record<string, string[]> | null;
  locale: Locale;
  loading: boolean;
  can: (module: string, action: string) => boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  permissions: null,
  locale: "en",
  loading: true,
  can: () => false,
  logout: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Record<string, string[]> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setPermissions(data.permissions ?? null);
      } else {
        setUser(null);
        setPermissions(null);
      }
    } catch {
      setUser(null);
      setPermissions(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setPermissions(null);
    window.location.href = "/login";
  };

  const can = (module: string, action: string): boolean => {
    if (!user) return false;
    if (user.is_super_admin) return true;
    return permissions?.[module]?.includes(action) ?? false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        locale: (user?.language as Locale) || "en",
        loading,
        can,
        logout,
        refreshUser: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
