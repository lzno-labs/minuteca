import { useCallback, useEffect, useState } from "react";
import { Check, Cpu, Download, Loader2, Trash2 } from "lucide-react";
import { messageFor } from "../lib/api";
import { chosenLocalModel, desktopBridge, hasLocalModels } from "../lib/desktop";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";

const mb = (bytes) => Math.round((bytes || 0) / 1e6);

/**
 * Settings, only inside the desktop app: the local speech models (docs/adr/0007), what suits this
 * computer, and downloading, choosing or deleting each. The choice stays on this computer.
 */
export default function LocalModels({ settings, onSettingsChange }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const bridge = desktopBridge();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null); // id being downloaded or deleted
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!hasLocalModels(bridge)) return;
    bridge.models().then(setData, (err) => setError(messageFor(err?.code || "engine_failed", 0)));
  }, [bridge]);
  useEffect(load, [load]);

  if (!hasLocalModels(bridge)) return null;
  const chosen = data ? chosenLocalModel(data.models, settings?.localModel) : null;
  const number = (n) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);

  const run = async (id, fn) => {
    setBusy(id);
    setError(null);
    setProgress(null);
    try {
      await fn();
    } catch (err) {
      setError(t("localModels.failed", { reason: messageFor(err?.code || "engine_failed", 0) }));
    } finally {
      setBusy(null);
      setProgress(null);
      load();
    }
  };
  const download = (m) => run(m.id, () => bridge.downloadModel(m.id, setProgress));
  const remove = async (m) => {
    if (await confirm({ title: t("localModels.deleteTitle", { model: m.name }), body: t("localModels.deleteBody"), confirmLabel: t("localModels.delete"), danger: true })) {
      run(m.id, () => bridge.deleteModel(m.id));
    }
  };
  const choose = (id) => onSettingsChange?.({ ...settings, localModel: id });

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <Cpu className="h-4 w-4 text-slate-500" /> {t("localModels.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("localModels.hint")}</p>
      {data && (
        <p className="mt-2 text-xs text-slate-500">
          {t("localModels.computer", { memory: number(data.specs.memoryGb), cores: data.specs.cores })}
          {data.specs.cpu ? ` · ${data.specs.cpu}` : ""}
        </p>
      )}
      {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {!data && !error && <Loader2 className="mt-4 h-5 w-5 animate-spin text-slate-400" />}

      {data && (
        <div role="radiogroup" aria-label={t("localModels.title")} className="mt-4 space-y-3">
          {data.models.map((m) => {
            const inUse = m.id === chosen;
            const speed =
              m.fit === "too_big"
                ? t("localModels.tooBig", { memory: m.minMemoryGb })
                : t(m.fit === "slow" ? "localModels.slow" : "localModels.speed", { minutes: m.minutesPerHour });
            return (
              <div key={m.id} className={`rounded-xl border p-4 ${inUse ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-200"}`}>
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={inUse}
                    aria-label={t("localModels.use", { model: m.name })}
                    onClick={() => choose(m.id)}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${inUse ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 hover:border-indigo-400"}`}
                  >
                    {inUse && <Check className="h-3 w-3" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{m.name}</span>
                      {m.recommended && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">{t("localModels.recommended")}</span>}
                      {m.downloaded ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                          <Check className="h-3 w-3" /> {t("localModels.downloaded")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t("localModels.size", { size: mb(m.size) })}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{t(`localModels.describe.${m.id}`)}</p>
                    <p className={`mt-1 text-xs ${m.fit === "ok" ? "text-slate-500" : "text-amber-700"}`}>{speed}</p>

                    {busy === m.id && progress?.total > 0 && (
                      <div className="mt-3 space-y-1" role="status">
                        <p className="text-xs text-indigo-800">{t("localModels.downloading", { done: mb(progress.done), total: mb(progress.total) })}</p>
                        <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100" aria-hidden="true">
                          <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, (100 * (progress.done ?? 0)) / progress.total)}%` }} />
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      {!m.downloaded && (
                        <button
                          type="button"
                          onClick={() => download(m)}
                          disabled={busy !== null || data.busy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {busy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {t("localModels.download", { size: mb(m.size) })}
                        </button>
                      )}
                      {busy === m.id && (
                        <button type="button" onClick={() => bridge.cancel()} className="rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100">
                          {t("common.cancel")}
                        </button>
                      )}
                      {m.downloaded && (
                        <button
                          type="button"
                          onClick={() => remove(m)}
                          disabled={busy !== null || data.busy}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t("localModels.delete")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data?.credits?.length > 0 && <p className="mt-4 text-xs text-slate-400">{t("localModels.credits", { credits: data.credits.join("; ") })}</p>}
    </section>
  );
}
