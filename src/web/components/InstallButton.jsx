import { useEffect, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";
import { useI18n } from "../i18n";

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * "Install app": uses the browser's install prompt where available
 * (Chrome/Edge on Android and desktop); on iPhone/iPad shows the
 * Share → Add to Home Screen steps, since Safari has no prompt API.
 * Hidden once the app runs installed.
 */
export default function InstallButton() {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!deferred && !isIOS())) return null;

  const click = async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({}));
      if (outcome === "accepted") setDeferred(null);
    } else {
      setShowHint((v) => !v);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={click}
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
        title={t("pwa.install")}
      >
        <Smartphone className="h-4 w-4" />
        <span className="hidden sm:inline">{t("pwa.install")}</span>
      </button>
      {showHint && (
        <div
          role="dialog"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-surface p-4 text-sm text-slate-700 shadow-xl"
        >
          <button
            type="button"
            onClick={() => setShowHint(false)}
            className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
          <p className="pr-6 font-semibold text-slate-900">{t("pwa.install")}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              {t("pwa.iosStep1")} <Share className="inline h-4 w-4 align-text-bottom" />
            </li>
            <li>{t("pwa.iosStep2")}</li>
            <li>{t("pwa.iosStep3")}</li>
          </ol>
        </div>
      )}
    </div>
  );
}
