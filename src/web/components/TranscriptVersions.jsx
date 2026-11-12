import { useState } from "react";
import { AlertTriangle, History, Loader2, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";

/**
 * Earlier transcripts of this meeting, kept when it was transcribed again, so people can compare
 * providers and go back. Using one swaps it in with its voice names; the current one is kept too.
 */
export default function TranscriptVersions({ meeting, onChanged }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const versions = meeting.transcriptVersions ?? [];
  const failed = meeting.status === "done" && meeting.error;
  if (!versions.length && !failed) return null;

  const name = (provider) => (provider ? t(`providers.${provider}.name`) : "?");
  const when = (iso) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const use = (v) => run(`use:${v.id}`, () => api(`/meetings/${meeting.id}/transcripts/${v.id}/use`, { method: "POST" }));
  const remove = async (v) => {
    if (await confirm({ title: t("transcriptVersions.deleteTitle"), body: t("transcriptVersions.deleteBody", { provider: name(v.provider) }), confirmLabel: t("meeting.deleteShort"), danger: true })) {
      run(`del:${v.id}`, () => api(`/meetings/${meeting.id}/transcripts/${v.id}`, { method: "DELETE" }));
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5">
      {failed && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("transcriptVersions.failed", { reason: t(`errors.${meeting.error}`) })}
        </p>
      )}
      {versions.length > 0 && (
        <>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <History className="h-4 w-4 text-slate-500" /> {t("transcriptVersions.title")}
          </h2>
          <p className="mt-1 text-xs text-slate-500">{t("transcriptVersions.hint")}</p>
          {meeting.transcript?.provider && (
            <p className="mt-2 text-sm text-slate-700">
              {t("transcriptVersions.current", { provider: meeting.transcript.provider === "local" ? t("transcriptVersions.local") : name(meeting.transcript.provider) })}
              {meeting.transcript.model && <span className="ml-1.5 font-mono text-xs text-slate-500">{meeting.transcript.model}</span>}
            </p>
          )}
          <ul className="mt-3 divide-y divide-slate-100">
            {versions.map((v) => {
              const names = Object.values(v.speakerNames ?? {}).filter(Boolean);
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-slate-900">
                      {v.provider === "local" ? t("transcriptVersions.local") : name(v.provider)}
                      {v.model && <span className="ml-1.5 font-mono text-xs font-normal text-slate-500">{v.model}</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {t("transcriptVersions.kept", { date: when(v.archivedAt) })}
                      {names.length > 0 && ` · ${names.join(", ")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => use(v)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busy === `use:${v.id}` && <Loader2 className="h-4 w-4 animate-spin" />} {t("transcriptVersions.use")}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(v)}
                    disabled={busy !== null}
                    aria-label={t("transcriptVersions.delete")}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
    </section>
  );
}
