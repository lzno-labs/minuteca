import { useEffect, useState } from "react";
import { Download, Laptop, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n";
import { desktopBridge } from "../lib/desktop";

const card = "rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm";
const button = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

/**
 * Settings: in a browser, where to get the desktop app; inside it, its version and updates
 * (docs/adr/0005). The app also checks on its own every few hours.
 */
export default function DesktopAppCard() {
  const { t } = useI18n();
  const bridge = desktopBridge();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bridge) return undefined;
    bridge.info().then(setInfo, () => {});
    return bridge.onUpdate((update) => setInfo((i) => (i ? { ...i, update } : i)));
  }, [bridge]);

  if (!bridge) {
    return (
      <section className={card}>
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <Laptop className="h-4 w-4 text-slate-500" /> {t("desktopApp.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("desktopApp.promo")}</p>
        <a href="/descargar" className={`mt-3 ${button}`}>
          <Download className="h-4 w-4" /> {t("desktopApp.get")}
        </a>
      </section>
    );
  }

  const u = info?.update ?? { status: "idle" };
  const status = {
    dev: t("desktopApp.dev"),
    checking: t("desktopApp.checking"),
    current: t("desktopApp.current"),
    downloading: t("desktopApp.downloading", { version: u.version ?? "" }),
    ready: t("desktopApp.ready", { version: u.version ?? "" }),
    available: t("desktopApp.available", { version: u.version ?? "" }),
    error: t("desktopApp.error"),
  }[u.status];

  const check = async () => {
    setBusy(true);
    try {
      const update = await bridge.checkForUpdates();
      setInfo((i) => ({ ...i, update }));
    } catch {
      setInfo((i) => ({ ...i, update: { status: "error" } }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <Laptop className="h-4 w-4 text-slate-500" /> {t("desktopApp.title")}
      </h2>
      {info && <p className="mt-1 text-sm text-slate-600">{t("desktopApp.version", { version: info.version })}</p>}
      {status && (
        <p className="mt-1 text-sm text-slate-600" role="status" aria-live="polite">
          {status}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {u.status === "ready" || u.status === "available" ? (
          <button type="button" onClick={() => bridge.installUpdate()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            {u.status === "ready" ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {u.status === "ready" ? t("desktopApp.restart") : t("desktopApp.download")}
          </button>
        ) : (
          <button type="button" onClick={check} disabled={busy || u.status === "checking" || u.status === "downloading" || u.status === "dev"} className={button}>
            {busy || u.status === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("desktopApp.check")}
          </button>
        )}
      </div>
    </section>
  );
}
