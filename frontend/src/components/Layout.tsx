import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLang } from "../lib/LangContext";
import { useAuth } from "../lib/AuthContext";
import { LANGUAGES } from "../lib/i18n";
import InstallPrompt from "./InstallPrompt";
import GuidedTour from "./GuidedTour";

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

export default function Layout() {
  const { lang, setLang, t } = useLang();
  const { users, userId, setUserId } = useAuth();
  const [offlineCount, setOfflineCount] = useState(readOfflineQueueLength);
  const [tourRunning, setTourRunning] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const startTour = () => {
    if (location.pathname !== "/") {
      navigate("/");
      // Give the Dashboard a moment to mount before Joyride queries its targets.
      setTimeout(() => setTourRunning(true), 250);
    } else {
      setTourRunning(true);
    }
  };

  useEffect(() => {
    // api.ts dispatches a synthetic "storage" event locally whenever the
    // offline_transfers queue changes (native storage events only fire in
    // *other* tabs), so this stays in sync with the badge/list elsewhere.
    const update = () => setOfflineCount(readOfflineQueueLength());
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <GuidedTour run={tourRunning} onFinish={() => setTourRunning(false)} />
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold">
              S
            </div>
            <div>
              <div className="font-semibold text-slate-900 leading-tight">{t("appName")}</div>
              <div className="text-xs text-slate-500 leading-tight">{t("tagline")}</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              {t("dashboard")}
            </NavLink>
            <NavLink to="/federated" className={linkClass}>
              {t("federated")}
            </NavLink>
            <NavLink to="/transfers" className={linkClass}>
              {t("transfers")}
            </NavLink>
            <NavLink to="/assistant" className={linkClass}>
              {t("assistant")}
            </NavLink>
            <NavLink
              to="/public"
              className="ml-1 px-3 py-1.5 rounded-md text-sm font-medium border border-teal-600 text-teal-700 hover:bg-teal-50 transition-colors"
            >
              Public Portal
            </NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={startTour}
              title="Take the tour"
              className="flex items-center gap-1 border border-slate-300 rounded-md text-sm px-2 py-1.5 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <span aria-hidden="true">🧭</span>
              <span className="hidden sm:inline">Take the tour</span>
            </button>
            <select
              value={userId ?? ""}
              onChange={(e) => setUserId(e.target.value || null)}
              title={t("actingAsHint")}
              className="border border-slate-300 rounded-md text-sm px-2 py-1.5 bg-white max-w-[220px]"
            >
              <option value="">{t("actingAsNone")}</option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.label}
                </option>
              ))}
            </select>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as typeof lang)}
              className="border border-slate-300 rounded-md text-sm px-2 py-1.5 bg-white"
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
          <div className="bg-amber-50 border-t border-amber-200 text-amber-800 text-xs px-4 py-2 text-center font-medium">
            ⚠️ {offlineCount} {offlineCount === 1 ? t("offlineTransferSingular") : t("offlineTransferPlural")}{" "}
            {t("offlineTransferWarning")}
          </div>
        )}
        <InstallPrompt />
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-4">
        SetuHealth — Federated AI platform for national PHC resource management · Built for India, extensible across BRICS
      </footer>
    </div>
  );
}
