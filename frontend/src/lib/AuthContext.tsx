import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ActingUser } from "./types";
import { api, ACTING_USER_KEY, SIGNED_OUT_EVENT, readToken, storeToken } from "./api";

type Mode = "demo" | "token";

interface AuthCtx {
  /** null until the server has said which mode it runs in. */
  mode: Mode | null;
  // Demo mode: the "acting as" picker.
  users: ActingUser[];
  userId: string | null;
  setUserId: (id: string | null) => void;
  // Both modes: who is acting. Token mode: the signed-in user, else null.
  user: ActingUser | null;
  signedIn: boolean;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

// Default acting identity for demo mode so the app is authorized-by-default out of
// the box (including the Dashboard's one-click "Run Demo" flow, which executes a
// transfer programmatically) rather than silently 401ing until someone finds the
// picker. Switching to a narrower phc_operator identity in the header is what
// demonstrates the 403 rejection path for an out-of-scope transfer.
const DEFAULT_USER_ID = "national_admin";

function readStoredUserId(): string | null {
  try {
    return localStorage.getItem(ACTING_USER_KEY);
  } catch {
    return null;
  }
}

// Persist the default demo identity as soon as this module loads, before any
// component mounts or fetches: api.ts's request interceptor reads it straight
// from localStorage, independent of React state, and children's mount effects
// commit before a parent AuthProvider's effects do. (In token mode the server
// ignores this header, and a stored session token takes precedence.)
try {
  if (!localStorage.getItem(ACTING_USER_KEY)) {
    localStorage.setItem(ACTING_USER_KEY, DEFAULT_USER_ID);
  }
} catch {
  // localStorage unavailable: requests simply go out unauthenticated
}

// Two modes, chosen by the server (AUTH_MODE):
//  * demo  - no login. Selecting a fixed identity sets the X-User-Id header the
//            api client attaches to every request. Fine for a demo, unsafe anywhere real.
//  * token - a real sign-in. The password is checked server-side, the reply is a
//            short-lived signed token, and every console request carries it.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [users, setUsers] = useState<ActingUser[]>([]);
  const [userId, setUserIdState] = useState<string | null>(() => readStoredUserId() ?? DEFAULT_USER_ID);
  const [sessionUser, setSessionUser] = useState<ActingUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .authConfig()
      .then(async ({ mode: m }) => {
        if (cancelled) return;
        setMode(m);
        if (m === "demo") {
          api.listUsers().then((u) => !cancelled && setUsers(u)).catch(() => setUsers([]));
        } else if (readToken()) {
          // Resume a stored session if the server still accepts it.
          try {
            const me = await api.me();
            if (!cancelled) setSessionUser(me);
            if (!me) storeToken(null);
          } catch {
            storeToken(null);
          }
        }
      })
      // Server unreachable: behave as demo mode so pages render their own errors.
      .catch(() => !cancelled && setMode("demo"));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onSignedOut = () => setSessionUser(null);
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  const setUserId = (id: string | null) => {
    setUserIdState(id);
    try {
      if (id) localStorage.setItem(ACTING_USER_KEY, id);
      else localStorage.removeItem(ACTING_USER_KEY);
    } catch {
      // localStorage unavailable: the selection just won't survive a reload
    }
  };

  const login = useCallback(async (id: string, password: string) => {
    const r = await api.login(id, password);
    storeToken(r.access_token);
    setSessionUser(r.user);
  }, []);

  const logout = useCallback(() => {
    storeToken(null);
    setSessionUser(null);
  }, []);

  const user = mode === "token" ? sessionUser : users.find((u) => u.user_id === userId) ?? null;

  return (
    <Ctx.Provider value={{ mode, users, userId, setUserId, user, signedIn: mode === "token" ? sessionUser !== null : true, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
