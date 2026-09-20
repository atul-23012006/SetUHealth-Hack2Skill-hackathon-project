import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "install_prompt_dismissed";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      if (localStorage.getItem(DISMISSED_KEY) === "1") return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !deferredPrompt) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  };

  return (
    <div className="bg-teal-50 border-t border-teal-200 text-teal-900 text-xs px-4 py-2 flex items-center justify-center gap-3 flex-wrap">
      <span>Install SetuHealth for offline field use.</span>
      <button
        onClick={install}
        className="bg-teal-600 text-white rounded-md px-2.5 py-1 font-medium hover:bg-teal-700 transition-colors"
      >
        Install
      </button>
      <button onClick={dismiss} className="text-teal-700 hover:text-teal-900 font-medium">
        Dismiss
      </button>
    </div>
  );
}
