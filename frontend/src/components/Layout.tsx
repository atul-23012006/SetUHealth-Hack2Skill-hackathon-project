import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowRightLeft, Globe, LayoutDashboard, LogOut, MapPin, Network, Search, Sparkles, TriangleAlert, UserRound, X } from "lucide-react";
import { useLang } from "../lib/LangContext";
import { useAuth } from "../lib/AuthContext";
import { REJECTED_KEY } from "../lib/api";
import { LANGUAGES } from "../lib/i18n";
import InstallPrompt from "./InstallPrompt";
import TourButton from "./TourButton";
import BrandMark from "./BrandMark";
import NotificationBell from "./NotificationBell";
import SignInPage from "./SignInPage";
import PageLoader from "./PageLoader";
const CommandPalette = lazy(() => import("./CommandPalette"));

function readOfflineQueueLength(): number {
  try {
    const raw = localStorage.getItem("offline_transfers");
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

interface RejectedTransfer {
  medicine: string;
  quantity: number;
  from_phc_id: string;
  to_phc_id: string;
  rejected_reason: string;
}

function readRejectedTransfers(): RejectedTransfer[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(REJECTED_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function Layout() {
  const { lang, setLang, t } = useLang();
  const { mode, signedIn, user, logout, users, userId, setUserId } = useAuth();
  // Token mode with nobody signed in: only the sign-in page (and the public portal) is reachable.
  const gated = mode === "token" && !signedIn;
  const [offlineCount, setOfflineCount] = useState(readOfflineQueueLength);
  const [rejected, setRejected] = useState(readRejectedTransfers);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    // api.ts dispatches a synthetic "storage" event locally whenever the
    // offline_transfers queue changes (native storage events only fire in
    // *other* tabs), so this stays in sync with the badge/list elsewhere.
    const update = () => {
      setOfflineCount(readOfflineQueueLength());
      setRejected(readRejectedTransfers());
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  // Ctrl/Cmd+K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dismissRejected = () => {
    try { localStorage.removeItem(REJECTED_KEY); } catch { /* storage unavailable */ }
    setRejected([]);
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200 ${
      isActive
        ? "bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-md shadow-brand-600/25"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="glass sticky top-0 z-20 border-b border-slate-200/70">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 flex-wrap">
          <NavLink to="/" end className="flex items-center gap-3 rounded-lg" aria-label={`${t("appName")} home`}>
            <BrandMark />
            <div>
              <div className="font-semibold leading-tight text-slate-900">{t("appName")}</div>
              <div className="hidden text-xs leading-tight text-slate-500 2xl:block">{t("tagline")}</div>
            </div>
          </NavLink>
          {gated ? (
            <NavLink to="/public" className="flex items-center gap-1.5 rounded-lg border border-brand-600 px-2.5 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
              <Globe size={15} aria-hidden="true" /> {t("nav.publicPortal")}
            </NavLink>
          ) : (
          <nav className="flex items-center gap-1" aria-label="Primary">
            <NavLink to="/" end className={linkClass}>
              <LayoutDashboard size={15} aria-hidden="true" />
              {t("dashboard")}
            </NavLink>
            <NavLink to="/explore" className={linkClass}>
              <MapPin size={15} aria-hidden="true" />
              {t("explore")}
            </NavLink>
            <NavLink to="/federated" className={linkClass}>
              <Network size={15} aria-hidden="true" />
              {t("federated")}
            </NavLink>
            <NavLink to="/transfers" className={linkClass}>
              <ArrowRightLeft size={15} aria-hidden="true" />
              {t("transfers")}
            </NavLink>
            <NavLink to="/assistant" className={linkClass}>
              <Sparkles size={15} aria-hidden="true" />
              {t("assistant")}
            </NavLink>
            <NavLink
              to="/public"
              className="ml-1 flex items-center gap-1.5 rounded-lg border border-brand-600 px-2.5 py-1.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
            >
              <Globe size={15} aria-hidden="true" />
              <span className="hidden 2xl:inline">{t("nav.publicPortal")}</span>
              <span className="2xl:hidden">{t("nav.public")}</span>
            </NavLink>
          </nav>
          )}
          <div className="flex items-center gap-2">
            {!gated && (
              <>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                title={t("nav.searchTitle")}
                aria-label={t("nav.searchAria")}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-sm text-slate-500 hover:border-brand-300 hover:bg-white"
              >
                <Search size={15} aria-hidden="true" />
                <kbd className="hidden rounded border border-slate-200 px-1 text-[10px] text-slate-400 2xl:inline">Ctrl K</kbd>
              </button>
              <NotificationBell />
              <TourButton key={location.pathname} />
                {mode === "token" ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-sm text-slate-700" title={user ? `${user.label} (${user.role})` : ""}>
                    <UserRound size={14} aria-hidden="true" className="text-slate-400" />
                    <span className="max-w-[130px] truncate">{user?.label ?? "Signed in"}</span>
                    <button onClick={logout} aria-label={t("nav.signOut")} title={t("nav.signOut")} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <LogOut size={14} />
                    </button>
                  </div>
                ) : (
              <select
                value={userId ?? ""}
                onChange={(e) => setUserId(e.target.value || null)}
                title={t("actingAsHint")}
                className="max-w-[150px] rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-sm"
              >
                <option value="">{t("actingAsNone")}</option>
                {users.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.label}
                  </option>
                ))}
              </select>
                )}
              </>
            )}
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as typeof lang)}
              className="rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {offlineCount > 0 && (
          <div className="flex items-center justify-center gap-1 border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800">
            <TriangleAlert size={12} className="shrink-0" />{" "}
            {offlineCount} {offlineCount === 1 ? t("offlineTransferSingular") : t("offlineTransferPlural")}{" "}
            {t("offlineTransferWarning")}
          </div>
        )}
        {rejected.length > 0 && (
          <div role="alert" className="flex items-start justify-center gap-2 border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {rejected.length} queued offline transfer{rejected.length === 1 ? " was" : "s were"} refused by the server and not applied:{" "}
              {rejected.slice(0, 2).map((r) => `${r.quantity} ${r.medicine} from ${r.from_phc_id} to ${r.to_phc_id} (${r.rejected_reason})`).join("; ")}
              {rejected.length > 2 ? `; and ${rejected.length - 2} more` : ""}.
            </span>
            <button onClick={dismissRejected} aria-label="Dismiss" className="ml-1 shrink-0 rounded p-0.5 hover:bg-rose-100">
              <X size={13} />
            </button>
          </div>
        )}
        <InstallPrompt />
        <span className="scroll-progress" aria-hidden="true" />
      </header>
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette open onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6">
        {/* Keyed by pathname so the entrance animation replays on navigation. */}
        <div key={location.pathname} className="page-enter">
          {mode === null ? (
            <PageLoader label={t("common.connecting")} />
          ) : gated ? (
            <SignInPage />
          ) : (
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          )}
        </div>
      </main>
      <footer className="border-t border-slate-200/70 py-5 text-center text-xs text-slate-400">
        <div>
          SetuHealth — Federated AI platform for national PHC resource management · Built for India, extensible across BRICS
        </div>
        <div className="mt-1 text-slate-400/80">{t("nav.syntheticNote")}</div>
      </footer>
    </div>
  );
}
