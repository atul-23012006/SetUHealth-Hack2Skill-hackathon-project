import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ActingUser } from "./types";
import { api, ACTING_USER_KEY } from "./api";

interface AuthCtx {
  users: ActingUser[];
  userId: string | null;
  user: ActingUser | null;
  setUserId: (id: string | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

// Default acting identity so the app is authorized-by-default out of the box
// (including the Dashboard's one-click "Run Demo" flow, which executes a
// transfer programmatically) rather than silently 401ing until someone finds
// the picker. Switching to a narrower phc_operator identity in the header is
// what demonstrates the 403 rejection path for an out-of-scope transfer.
const DEFAULT_USER_ID = "national_admin";

function readStoredUserId(): string | null {
  try {
    return localStorage.getItem(ACTING_USER_KEY);
  } catch {
    return null;
  }
}

// Persist the default identity to localStorage as soon as this module loads
// — before any component mounts or fetches anything. api.ts's request
// interceptor reads X-User-Id straight from localStorage, independent of
// React state; if the default only lived in this component's useState, the
// very first page-load requests (which fire from child components' own
// mount effects, which commit *before* a parent AuthProvider's effects do)
// would already have gone out with no header at all.
try {
  if (!localStorage.getItem(ACTING_USER_KEY)) {
    localStorage.setItem(ACTING_USER_KEY, DEFAULT_USER_ID);
  }
} catch {
  // localStorage unavailable — requests simply go out unauthenticated
}

// Tracks which fixed demo identity the operator is "acting as". There's no
// real login here — selecting a user just sets the X-User-Id header the api
// client attaches to every request (see lib/api.ts), which the backend uses
// to authorize (or reject) transfer requests. Persisted to localStorage so
// the choice survives a page reload.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<ActingUser[]>([]);
  const [userId, setUserIdState] = useState<string | null>(() => readStoredUserId() ?? DEFAULT_USER_ID);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const setUserId = (id: string | null) => {
    setUserIdState(id);
    try {
      if (id) localStorage.setItem(ACTING_USER_KEY, id);
      else localStorage.removeItem(ACTING_USER_KEY);
    } catch {
      // localStorage unavailable — selection just won't survive a reload
    }
  };

  const user = users.find((u) => u.user_id === userId) ?? null;

  return <Ctx.Provider value={{ users, userId, user, setUserId }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
