import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "../i18n";

/**
 * Shown when a new version has been downloaded. The user decides when to
 * reload, so an update never interrupts a recording. Checks hourly.
 */
export default function UpdatePrompt({ busy }) {
  const { t } = useI18n();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
    >
      <RefreshCw className="h-4 w-4 shrink-0" />
      <span className="flex-1">{busy ? t("pwa.updateAfterRecording") : t("pwa.updateAvailable")}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => updateServiceWorker(true)}
        className="rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
      >
        {t("pwa.update")}
      </button>
      <button type="button" onClick={() => setNeedRefresh(false)} className="px-1 text-slate-300 hover:text-white">
        {t("pwa.later")}
      </button>
    </div>
  );
}
