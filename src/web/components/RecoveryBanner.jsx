import { useState } from "react";
import { LifeBuoy, Download, Trash2, Sparkles, Loader2 } from "lucide-react";
import { formatDuration } from "../lib/format";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";

/**
 * Lists recordings that were never finalized (tab crash, reload, or failed
 * transcription) and offers to restore them.
 */
export default function RecoveryBanner({ sessions, onRestore, onDownload, onDiscard, busy }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [working, setWorking] = useState(null);
  if (!sessions?.length) return null;

  const run = async (id, fn) => {
    setWorking(id);
    try {
      await fn(id);
    } finally {
      setWorking(null);
    }
  };

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-amber-900">
        <LifeBuoy className="h-5 w-5" />
        <h2 className="font-semibold">
          {t("recovery.found", { count: sessions.length })}
        </h2>
      </div>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-3 rounded-xl bg-surface/80 p-3 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="text-sm">
              <div className="font-medium text-slate-900">
                {new Date(s.startedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
              </div>
              <div className="text-slate-600">
                {t("recovery.recorded", { duration: formatDuration((s.elapsedMs || 0) / 1000) })} ·{" "}
                {s.status === "stopped" ? t("recovery.notTranscribed") : t("recovery.interrupted")}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || working === s.id}
                onClick={() => run(s.id, onRestore)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {working === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("recovery.restore")}
              </button>
              <button
                type="button"
                onClick={() => onDownload(s.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-surface px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                title={t("recovery.downloadRaw")}
              >
                <Download className="h-4 w-4" /> {t("common.audio")}
              </button>
              <button
                type="button"
                disabled={busy || working === s.id}
                onClick={async () => {
                  if (await confirm({ title: t("recovery.discard"), body: t("recovery.discardConfirm"), confirmLabel: t("recovery.discard"), danger: true })) onDiscard(s.id);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> {t("recovery.discard")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
