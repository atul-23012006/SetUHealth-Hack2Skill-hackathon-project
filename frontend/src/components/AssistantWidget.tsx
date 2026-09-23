import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
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
    let received = "";
    try {
      await api.chatStream(query, lang, state, (delta) => {
        received += delta;
        setReply((prev) => prev + delta);
      }, controller.signal);
      speak(received);
    } catch {
      if (controller.signal.aborted) return; // the operator pressed Stop; keep what has arrived
      if (received === "") {
        // Streaming failed before any text (e.g. a proxy that buffers): fall back to the one-shot endpoint.
        try {
          const reply = await api.chat(query, lang, state);
          setReply(() => reply);
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
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
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
