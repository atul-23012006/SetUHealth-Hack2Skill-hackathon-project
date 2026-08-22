import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import AssistantWidget from "../components/AssistantWidget";

export default function Assistant() {
  const { t } = useLang();
  const [states, setStates] = useState<string[]>([]);
  const [state, setState] = useState<string>("");

  useEffect(() => {
    api.states().then((s) => setStates(Object.keys(s)));
  }, []);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t("assistant")}</h1>
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="border border-slate-300 rounded-md text-sm px-2 py-1.5 bg-white"
        >
          <option value="">{t("selectState")}</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <AssistantWidget state={state || undefined} />
    </div>
  );
}
