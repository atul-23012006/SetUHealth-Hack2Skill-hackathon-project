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
  // Jurisdiction: a national_admin (or nobody signed in yet, which only
  // happens in demo mode — token mode gates the whole console behind
  // sign-in) has unrestricted access, matching today's behavior. A
  // state_coordinator or phc_operator is scoped to their own domain: see
  // README's authorize_transfer for the backend half of this same model.
  role: string | null;
  isNational: boolean;
  homeState: string | null;
  homePhcId: string | null;
  /** Where this role's console starts — the state/facility dashboard for a
   * scoped role, or "/" (the national Dashboard) for a national_admin. */
  homePath: string;
  canAccessState: (state: string) => boolean;
  canAccessPhc: (phcId: string, phcState: string) => boolean;
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

  const role = user?.role ?? null;
  const homeState = role === "state_coordinator" ? user!.authorized_states.find((s) => s !== "*") ?? null : null;
  const homePhcId = role === "phc_operator" ? user!.authorized_phc_ids[0] ?? null : null;
  // Anyone whose role isn't a scoped one (national_admin, an unrecognized
  // role, or no user at all) is unrestricted, matching today's behavior. A
  // scoped role with nothing actually assigned to scope them to (a
  // misconfigured account — the shipped roster never produces this) also
  // falls back to unrestricted: there's nowhere else to send them, and
  // every page's guard redirecting to itself would otherwise loop.
  const isScopedRole = role === "phc_operator" || role === "state_coordinator";
  const isNational = !user || !isScopedRole || (!homeState && !homePhcId);
  const homePath = homePhcId ? `/phcs/${encodeURIComponent(homePhcId)}`
    : homeState ? `/states/${encodeURIComponent(homeState)}`
    : "/";

  const canAccessState = (state: string) => {
    if (isNational) return true;
    if (role === "state_coordinator") return user!.authorized_states.includes(state);
    return false; // a phc_operator has no state-level view, even their own
  };
  const canAccessPhc = (phcId: string, phcState: string) => {
    if (isNational) return true;
    if (role === "phc_operator") return user!.authorized_phc_ids.includes(phcId);
    if (role === "state_coordinator") return canAccessState(phcState);
    return false;
  };

  return (
    <Ctx.Provider value={{
      mode, users, userId, setUserId, user, signedIn: mode === "token" ? sessionUser !== null : true, login, logout,
      role, isNational, homeState, homePhcId, homePath, canAccessState, canAccessPhc,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
