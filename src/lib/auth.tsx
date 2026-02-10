"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { getMe, normalizeSessionId } from "./api";

interface AuthState {
  uid: string | null;
  email: string | null;
  sessions: string[];
  loading: boolean;
  logout: () => void;
  addSession: (sid: string) => void;
}

const AuthContext = createContext<AuthState>({
  uid: null,
  email: null,
  sessions: [],
  loading: true,
  logout: () => {},
  addSession: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem("uid");
    localStorage.removeItem("email");
    setUid(null);
    setEmail(null);
    setSessions([]);
    router.push("/");
  }, [router]);

  const addSession = useCallback((sid: string) => {
    setSessions((prev) => (prev.includes(sid) ? prev : [sid, ...prev]));
  }, []);

  useEffect(() => {
    const storedUid = localStorage.getItem("uid");
    const storedEmail = localStorage.getItem("email");

    if (!storedUid || !storedEmail) {
      setLoading(false);
      return;
    }

    getMe(storedUid)
      .then((data) => {
        setUid(data.uid);
        setEmail(data.email);
        setSessions((data.sessions || []).map(normalizeSessionId));
      })
      .catch((err) => {
        console.warn("[Auth] getMe failed:", err.message);
        // Only clear credentials if it's a definitive auth failure (not a network error)
        if (err.message === "Invalid session") {
          localStorage.removeItem("uid");
          localStorage.removeItem("email");
        } else {
          // Network error — keep credentials, use what we have from localStorage
          setUid(storedUid);
          setEmail(storedEmail);
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <AuthContext.Provider value={{ uid, email, sessions, loading, logout, addSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
