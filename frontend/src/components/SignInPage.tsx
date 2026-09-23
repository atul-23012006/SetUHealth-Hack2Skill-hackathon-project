import { useState, type FormEvent } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useLang } from "../lib/LangContext";
import { errorMessage } from "../lib/useAsync";
import BrandMark from "./BrandMark";

// Shown in place of the console when the server runs in token mode and nobody is
// signed in. The public portal never needs it.
export default function SignInPage() {
  const { login } = useAuth();
  const { t } = useLang();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(userId.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <form onSubmit={submit} className="card p-7" aria-label={t("signin.title")}>
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <div>
            <div className="font-[family-name:var(--font-display)] text-xl font-semibold text-slate-900">{t("signin.title")}</div>
            <div className="text-xs text-slate-500">{t("signin.subtitle")}</div>
          </div>
        </div>

        <label className="mt-6 block text-xs font-semibold text-slate-600" htmlFor="signin-user">{t("signin.user")}</label>
        <input
          id="signin-user" value={userId} onChange={(e) => setUserId(e.target.value)}
          autoComplete="username" autoFocus required
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        <label className="mt-4 block text-xs font-semibold text-slate-600" htmlFor="signin-password">{t("signin.password")}</label>
        <input
          id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" required
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
        />

        {error && <div role="alert" className="animate-fade-in mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

        <button
          type="submit" disabled={busy || !userId || !password}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />} {t("signin.submit")}
        </button>
        <p className="mt-4 text-center text-[11px] leading-snug text-slate-400">
          {t("signin.note")}
        </p>
      </form>
    </div>
  );
}
