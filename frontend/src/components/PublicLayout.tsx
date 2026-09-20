import { Link, Outlet } from "react-router-dom";

// Deliberately minimal and separate from components/Layout.tsx: no "acting
// as" user selector, no offline-queue banner, no transfer-execute affordances
// — this surface is read-only and needs none of the officer console's state.
export default function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-gradient-to-r from-teal-950 via-slate-900 to-slate-950 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <Link to="/public" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-500 text-white flex items-center justify-center font-bold">
              S
            </div>
            <div>
              <div className="font-semibold leading-tight">SetuHealth Public Network</div>
              <div className="text-xs text-teal-300 leading-tight">Open, aggregate-only transparency portal</div>
            </div>
          </Link>
          <Link
            to="/"
            className="text-xs border border-teal-700 text-teal-200 hover:bg-teal-900/40 rounded-md px-3 py-1.5 transition-colors"
          >
            Officer Console →
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-4">
        SetuHealth Public Network — every figure here is a state or national aggregate; no facility-level or patient data is ever shown.
      </footer>
    </div>
  );
}
