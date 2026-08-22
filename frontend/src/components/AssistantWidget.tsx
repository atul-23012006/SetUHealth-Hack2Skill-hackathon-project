import { useRef, useState } from "react";
import { useLang } from "../lib/LangContext";
import { LANGUAGES } from "../lib/i18n";
import { api } from "../lib/api";

interface Message {
  role: "user" | "assistant";
  text: string;
}

// Minimal ambient typing for the Web Speech API (not in default TS lib dom types).
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (event: any) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function AssistantWidget({ state }: { state?: string }) {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const speechSupported = !!getSpeechRecognition();
  const speechLang = LANGUAGES.find((l) => l.code === lang)?.speechCode ?? "en-IN";

  const send = async (text: string) => {
    const query = text.trim();
    if (!query) return;
    setMessages((m) => [...m, { role: "user", text: query }]);
    setInput("");
    setSending(true);
    try {
      const reply = await api.chat(query, lang, state);
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      speak(reply);
    } finally {
      setSending(false);
    }
  };

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const toggleListen = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = speechLang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      send(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[520px]">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-slate-400 text-center mt-10">{t("askAssistant")}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && <div className="text-xs text-slate-400">…</div>}
      </div>
      <div className="border-t border-slate-200 p-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={t("assistantPlaceholder")}
          className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm"
        />
        {speechSupported && (
          <button
            onClick={toggleListen}
            className={`px-3 py-2 rounded-md text-sm border ${
              listening ? "bg-rose-600 text-white border-rose-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
            title={t("speak")}
          >
            {listening ? t("listening") : "🎤"}
          </button>
        )}
        <button
          onClick={() => send(input)}
          className="px-3 py-2 rounded-md text-sm bg-teal-600 text-white hover:bg-teal-700"
        >
          {t("send")}
        </button>
      </div>
    </div>
  );
}
