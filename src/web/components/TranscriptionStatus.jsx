import { Loader2, UploadCloud, AlertTriangle, RotateCcw, X } from "lucide-react";
import { useI18n } from "../i18n";

export default function TranscriptionStatus({ job, onRetry, onDismiss }) {
  const { t } = useI18n();
  if (!job) return null;

  if (job.error) {
    return (
      <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 sm:p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">{t("status.failed")}</p>
            <p className="mt-1">{job.error}</p>
            <p className="mt-1 text-rose-700">{t("status.safe")}</p>
          </div>
          <div className="flex gap-2">
            {job.retryable !== false && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
              >
                <RotateCcw className="h-4 w-4" /> {t("common.retry")}
              </button>
            )}
            <button type="button" onClick={onDismiss} className="rounded-lg p-1.5 hover:bg-rose-100" aria-label={t("common.close")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    );
  }

  const uploading = job.phase === "uploading";
  const pct = Math.round((job.progress || 0) * 100);
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-900 sm:p-5" aria-live="polite">
      <div className="flex items-center gap-3">
        {uploading ? <UploadCloud className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
        <div className="flex-1 text-sm">
          <p className="font-semibold">{uploading ? t("status.uploading", { pct }) : t("status.saving")}</p>
          <p className="text-indigo-700">
            {t("status.keepOpen")}
          </p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-indigo-100">
        <div
          className={`h-full rounded-full bg-indigo-600 transition-all ${uploading ? "" : "w-1/3 animate-pulse"}`}
          style={uploading ? { width: `${pct}%` } : undefined}
        />
      </div>
    </section>
  );
}
