import { Suspense } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import TourButton from "./TourButton";
import BrandMark from "./BrandMark";
import { useLang } from "../lib/LangContext";
import { LANGUAGES } from "../lib/i18n";
import PageLoader from "./PageLoader";

// Deliberately minimal and separate from components/Layout.tsx: no "acting
// as" user selector, no offline-queue banner, no transfer-execute affordances
// — this surface is read-only and needs none of the officer console's state.
export default function PublicLayout() {
  const location = useLocation();
  const { lang, setLang, t } = useLang();
  return (
    <div className="flex min-h-screen flex-col bg-surface-warm">
      <header className="relative bg-gradient-to-r from-brand-950 via-slate-900 to-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3.5">
          <Link to="/public" className="flex items-center gap-3">
            <BrandMark tone="public" />
            <div>
              <div className="font-semibold leading-tight">{t("pub.layout.title")}</div>
              <div className="text-xs leading-tight text-brand-300">{t("pub.layout.sub")}</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <TourButton key={location.pathname} tone="dark" />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as typeof lang)}
              aria-label="Language"
              className="rounded-lg border border-brand-700 bg-transparent px-2 py-1.5 text-xs text-brand-200"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="text-slate-900">
                  {l.label}
                </option>
              ))}
            </select>
            <Link
              to="/"
              className="rounded-lg border border-brand-700 px-3 py-1.5 text-xs text-brand-200 transition-colors hover:bg-brand-900/40"
            >
              {t("pub.layout.console")}
            </Link>
          </div>
        </div>
        <span className="scroll-progress" aria-hidden="true" />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div key={location.pathname} className="page-enter">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <footer className="py-5 text-center text-xs text-slate-400">
        {t("pub.footer")}
      </footer>
    </div>
  );
}
