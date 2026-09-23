import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing, CheckCheck, CloudLightning, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/useAsync";
import { useLang } from "../lib/LangContext";
import type { AppNotification, NotificationConfig } from "../lib/types";

const POLL_MS = 60_000;
const DESKTOP_KEY = "setuhealth_desktop_alerts";

function timeAgo(iso: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("notif.time.now");
  if (s < 3600) return t("notif.time.min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("notif.time.hour", { n: Math.floor(s / 3600) });
  return t("notif.time.day", { n: Math.floor(s / 86400) });
}

function desktopEnabled(): boolean {
  try {
    return localStorage.getItem(DESKTOP_KEY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

// Alerts for real weather signals turning high. The server polls and stores them;
// this polls the server, shows an unread badge, and (only if the operator opts in)
// raises a desktop notification for anything new.
export default function NotificationBell() {
  const navigate = useNavigate();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(desktopEnabled);
  const rootRef = useRef<HTMLDivElement>(null);
  const maxSeen = useRef<number | null>(null); // highest id already known, so history never re-notifies

  const refresh = useCallback(async () => {
    try {
      const data = await api.notifications(false, 20);
      setItems(data.items);
      setUnread(data.unread);
      const newest = data.items.length ? data.items[0].id : 0;
      if (maxSeen.current !== null && desktopEnabled()) {
        for (const n of data.items) {
          if (n.id > maxSeen.current && !n.read) new Notification(n.title, { body: n.body, tag: `setu-${n.id}` });
        }
      }
      maxSeen.current = Math.max(maxSeen.current ?? 0, newest);
    } catch {
      /* the bell simply keeps its last state while the server is unreachable */
    }
  }, []);

  useEffect(() => {
    refresh();
    api.notificationConfig().then(setConfig).catch(() => {});
    const id = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const openItem = async (n: AppNotification) => {
    if (!n.read) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api.markNotificationsRead([n.id]).catch(() => {});
    }
    setOpen(false);
    navigate("/");
    setTimeout(() => document.getElementById("live-signals")?.scrollIntoView({ behavior: "smooth", block: "start" }), 700);
  };

  const markAll = async () => {
    setItems((cur) => cur.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await api.markNotificationsRead().catch(() => {});
  };

  const checkNow = async () => {
    setChecking(true);
    setMessage(null);
    try {
      const r = await api.checkSignalsNow();
      setMessage(r.created.length ? t("notif.newCount", { n: r.created.length }) : t("notif.noneNew"));
      await refresh();
    } catch (err) {
      setMessage(`Couldn't check: ${errorMessage(err)}`);
    } finally {
      setChecking(false);
    }
  };

  const toggleDesktop = async () => {
    if (desktop) {
      try { localStorage.removeItem(DESKTOP_KEY); } catch { /* storage unavailable */ }
      return setDesktop(false);
    }
    if (typeof Notification === "undefined") return setMessage("This browser doesn't support desktop notifications.");
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") {
      try { localStorage.setItem(DESKTOP_KEY, "1"); } catch { /* storage unavailable */ }
      setDesktop(true);
    } else {
      setMessage("Permission was blocked. Allow notifications for this site in your browser to enable it.");
    }
  };

  const Icon = unread > 0 ? BellRing : Bell;

  return (
    <div ref={rootRef} className="relative" id="notification-bell">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("notif.aria", { n: unread })}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex items-center rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-slate-500 hover:border-brand-300 hover:bg-white"
      >
        <Icon size={15} aria-hidden="true" className={unread > 0 ? "text-rose-600" : ""} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-w-[16px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label={t("notif.title")} className="animate-tour-pop absolute right-0 top-full z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-800">{t("notif.title")}</div>
            <div className="flex items-center gap-1">
              <button onClick={checkNow} disabled={checking} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                {checking ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />} {t("notif.checkNow")}
              </button>
              <button onClick={markAll} disabled={unread === 0} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">
                <CheckCheck size={12} aria-hidden="true" /> {t("notif.markAll")}
              </button>
            </div>
          </div>

          {message && <div role="status" className="animate-fade-in border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">{message}</div>}

          <ul className="max-h-[52vh] overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-xs text-slate-400">
                {t("notif.empty")}
              </li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${n.read ? "" : "bg-rose-50/40"}`}
                >
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${n.read ? "bg-slate-100 text-slate-400" : "bg-rose-100 text-rose-600"}`}>
                    <CloudLightning size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`text-sm ${n.read ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</span>
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="unread" />}
                    </span>
                    <span className="mt-0.5 line-clamp-3 block text-xs leading-snug text-slate-500">{n.body}</span>
                    <span className="mt-1 block text-[10px] text-slate-400">{timeAgo(n.ts, t)} · {n.delivery ?? "in-app"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" role="switch" checked={desktop} onChange={toggleDesktop} className="h-3.5 w-3.5 accent-brand-600" />
              {t("notif.desktop")}
            </label>
            <p className="text-[10px] leading-snug text-slate-400">
              {config
                ? `${t("notif.polling", { n: config.poll_minutes })}${config.polling_enabled ? "" : " " + t("notif.pollingOff")} ${
                    config.webhook_configured ? t("notif.webhookOn") : t("notif.webhookOff")
                  }`
                : t("notif.settingsLoading")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
