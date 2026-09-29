import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Mic, Square } from "lucide-react";
import { useLang } from "../lib/LangContext";
import { LANGUAGES } from "../lib/i18n";
import { api } from "../lib/api";
import type { RelatedFacility } from "../lib/types";

interface Message {
  role: "user" | "assistant";
  text: string;
  // Facilities the reply named (matched server-side, see assistant.py), shown
  // as links once the reply is complete.
  related?: RelatedFacility[];
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
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest text in view while a reply streams in; abort on unmount.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const speechSupported = !!getSpeechRecognition();
  const speechLang = LANGUAGES.find((l) => l.code === lang)?.speechCode ?? "en-IN";

  const send = async (text: string) => {
    const query = text.trim();
    if (!query || sending) return;
    setMessages((m) => [...m, { role: "user", text: query }, { role: "assistant", text: "" }]);
    setInput("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const setReply = (fn: (prev: string) => string) =>
      setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, text: fn(msg.text) } : msg)));
    const setRelated = (related: RelatedFacility[]) =>
      setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, related } : msg)));
    let received = "";
    try {
      await api.chatStream(query, lang, state, (delta) => {
        received += delta;
        setReply((prev) => prev + delta);
      }, controller.signal, setRelated);
      speak(received);
    } catch {
      if (controller.signal.aborted) return; // the operator pressed Stop; keep what has arrived
      if (received === "") {
        // Streaming failed before any text (e.g. a proxy that buffers): fall back to the one-shot endpoint.
        try {
          const { reply, related } = await api.chat(query, lang, state);
          setReply(() => reply);
          setRelated(related);
          speak(reply);
        } catch {
          setReply(() => "Sorry, I couldn't get an answer. Please try again.");
        }
      }
    } finally {
      setSending(false);
      abortRef.current = null;
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
    <div id="assistant-chat" className="card flex flex-col h-[520px]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-slate-400 text-center mt-10">{t("askAssistant")}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.text || (sending && i === messages.length - 1 ? (
                <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant is typing">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                </span>
              ) : null)}
            </div>
            {m.related && m.related.length > 0 && (
              <div className="mt-1.5 flex max-w-[80%] flex-wrap items-center gap-1.5" aria-label={t("assistant.related")}>
                <span className="text-[11px] text-slate-400">{t("assistant.related")}</span>
                {m.related.map((f) => (
                  <Link
                    key={f.phc_id}
                    to={`/phcs/${f.phc_id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                  >
                    <Building2 size={11} aria-hidden="true" /> {f.phc_name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 p-3 flex items-center gap-2">
        <input
          id="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={t("assistantPlaceholder")}
          className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm"
        />
        {speechSupported && (
          <button
            id="assistant-mic"
            onClick={toggleListen}
            className={`px-3 py-2 rounded-md text-sm border ${
              listening ? "bg-rose-600 text-white border-rose-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
            title={t("speak")}
          >
            {listening ? t("listening") : <Mic size={16} />}
          </button>
        )}
        {sending ? (
          <button
            onClick={() => abortRef.current?.abort()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm bg-slate-800 text-white hover:bg-slate-700"
            aria-label="Stop generating"
          >
            <Square size={13} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button
            onClick={() => send(input)}
            className="px-3 py-2 rounded-md text-sm bg-brand-600 text-white hover:bg-brand-700"
          >
            {t("send")}
          </button>
        )}
      </div>
    </div>
  );
}
