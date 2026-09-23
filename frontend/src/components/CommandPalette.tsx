import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightLeft, Building2, CornerDownLeft, Globe, LayoutDashboard, MapPin, Network, Search, Sparkles, type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { PHC } from "../lib/types";

type Group = "pages" | "states" | "facilities";

interface Item {
  id: string;
  label: string;
  hint: string;
  group: Group;
  icon: LucideIcon;
  to: string;
}

// Loaded once per session, on first open.
let directory: Promise<{ states: string[]; phcs: PHC[] }> | null = null;
function loadDirectory() {
  directory ??= Promise.all([api.states(), api.phcs()]).then(([s, p]) => ({ states: Object.keys(s), phcs: p }));
  directory.catch(() => { directory = null; }); // a failed load can be retried on the next open
  return directory;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<{ states: string[]; phcs: PHC[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Built at render so labels and hints follow the selected language.
  const items = useMemo<Item[]>(() => {
    const pages: Item[] = [
      { id: "p-dash", label: t("dashboard"), hint: t("palette.hint.dashboard"), group: "pages", icon: LayoutDashboard, to: "/" },
      { id: "p-explore", label: t("explore"), hint: t("palette.hint.explore"), group: "pages", icon: MapPin, to: "/explore" },
      { id: "p-fed", label: t("federated"), hint: t("palette.hint.federated"), group: "pages", icon: Network, to: "/federated" },
      { id: "p-tr", label: t("transfers"), hint: t("palette.hint.transfers"), group: "pages", icon: ArrowRightLeft, to: "/transfers" },
      { id: "p-as", label: t("assistant"), hint: t("palette.hint.assistant"), group: "pages", icon: Sparkles, to: "/assistant" },
      { id: "p-pub", label: t("nav.publicPortal"), hint: t("palette.hint.public"), group: "pages", icon: Globe, to: "/public" },
    ];
    if (!dir) return pages; // pages still work if the directory can't load
    return [
      ...pages,
      ...dir.states.map<Item>((s) => ({ id: `s-${s}`, label: s, hint: t("palette.stateView"), group: "states", icon: MapPin, to: `/states/${encodeURIComponent(s)}` })),
      ...dir.phcs.map<Item>((p) => ({ id: `f-${p.id}`, label: p.name, hint: `${p.district}, ${p.state} · ${p.id}`, group: "facilities", icon: Building2, to: `/phcs/${p.id}` })),
    ];
  }, [t, dir]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    loadDirectory().then(setDir).catch(() => setDir(null));
  }, [open]);

  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = tokens.length
      ? items.filter((i) => tokens.every((tok) => `${i.label} ${i.hint}`.toLowerCase().includes(tok)))
      : items.filter((i) => i.group !== "facilities");
    // Cap each group so 150+ facilities don't bury pages and states.
    const seen: Record<string, number> = {};
    return matches.filter((i) => (seen[i.group] = (seen[i.group] ?? 0) + 1) <= (i.group === "facilities" ? 8 : 12));
  }, [items, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.to);
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={t("palette.label")}>
      <div className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-tour-pop relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search size={17} className="text-slate-400" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") go(results[index]);
              else if (e.key === "Escape") onClose();
            }}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.label")}
            className="h-12 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">Esc</kbd>
        </div>
        <ul ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-slate-400">{t("palette.empty", { q: query })}</li>}
          {results.map((r, i) => {
            const Icon = r.icon;
            const startsGroup = i === 0 || results[i - 1].group !== r.group;
            return (
              <li key={r.id} role="presentation">
                {startsGroup && <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t(`palette.group.${r.group}`)}</div>}
                <div
                  role="option"
                  aria-selected={i === index}
                  data-idx={i}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(r)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${i === index ? "bg-brand-50" : ""}`}
                >
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${i === index ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{r.label}</span>
                    <span className="block truncate text-[11px] text-slate-400">{r.hint}</span>
                  </span>
                  {i === index && <CornerDownLeft size={13} className="text-slate-400" aria-hidden="true" />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[10px] text-slate-400">
          <span>{t("palette.keys.nav")}</span><span>{t("palette.keys.open")}</span><span>{t("palette.keys.close")}</span>
        </div>
      </div>
    </div>
  );
}
