import { useState } from "react";
import { AlertTriangle, ChevronDown, KeyRound, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { startTranscription } from "../lib/cloud";
import { AUDIO_LANGUAGES } from "../lib/browser";
import { keySource, PROVIDER_IDS, usableProvider } from "../lib/providers";
import { formatDuration } from "../lib/format";
import { useI18n } from "../i18n";
import Dialog from "./Dialog";

/**
 * The main action of a meeting that is not transcribed yet. Says where the audio goes and who
 * pays before anything leaves. The first time a person uses a provider, it asks for permission
 * (stored on the server, which refuses without it).
 */
export default function TranscribePanel({ meeting, me, onMeChange, onStarted, onOpenSettings, settings }) {
  const { t } = useI18n();
  const [provider, setProvider] = useState(() => usableProvider(me) ?? me?.provider ?? "deepgram");
  const [language, setLanguage] = useState(settings?.language ?? "es");
  const [options, setOptions] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const source = keySource(me, provider);
  const name = t(`providers.${provider}.name`);
  const languageLabel = t(`audioLanguages.${AUDIO_LANGUAGES.find((l) => l.value === language)?.key ?? "auto"}`);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await startTranscription(meeting.id, { provider, language: provider !== "deepgram" && language === "multi" ? "" : language });
      onStarted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const go = () => (me.consents.includes(provider) ? run() : setAsking(true));

  const accept = async () => {
    setAsking(false);
    try {
      await api("/me/consents", { method: "PUT", body: { provider, granted: true } });
      await onMeChange?.();
      await run();
    } catch (err) {
      setError(err.message);
    }
  };

  if (meeting.status === "transcribing") {
    return (
      <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-900" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
          <div>
            <p className="font-semibold">{t("transcribe.inProgress", { provider: t(`providers.${meeting.provider}.name`) })}</p>
            <p className="text-sm text-indigo-700">{t("transcribe.canLeave")}</p>
          </div>
        </div>
      </section>
    );
  }

  const select = "w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            meeting.status === "error" ? "bg-rose-50 text-rose-600" : "bg-indigo-50 text-indigo-600"
          }`}
        >
          {meeting.status === "error" ? <AlertTriangle className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </span>
        <div>
          <h2 className="font-semibold text-slate-900">{meeting.status === "error" ? t("transcribe.retryTitle") : t("transcribe.ready")}</h2>
          <p className="text-sm text-slate-600" role={meeting.status === "error" ? "alert" : undefined}>
            {meeting.status === "error"
              ? t("transcribe.failed", { reason: t(`errors.${meeting.error}`) })
              : meeting.duration
                ? t("transcribe.readyHint", { duration: formatDuration(meeting.duration) })
                : t("transcribe.readyHintNoLength")}
          </p>
        </div>
      </div>

      {source ? (
        <>
          <button
            type="button"
            onClick={go}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 sm:w-auto"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : meeting.status === "error" ? <RotateCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {t("transcribe.startWith", { provider: name })}
          </button>
          <p className="text-xs leading-relaxed text-slate-500">
            {t("transcribe.destination", { provider: name, where: t(`providers.${provider}.where`) })}{" "}
            {t(source === "own" ? "transcribe.paidOwn" : "transcribe.paidHosted", { provider: name })}
          </p>
        </>
      ) : (
        <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t("transcribe.noKey", { provider: name })}</p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 font-semibold text-white hover:bg-amber-700"
          >
            <KeyRound className="h-4 w-4" /> {t("transcribe.addKey")}
          </button>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setOptions((o) => !o)}
          aria-expanded={options}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          {t("transcribe.options", { provider: name, language: languageLabel })}
          <ChevronDown className={`h-4 w-4 transition ${options ? "rotate-180" : ""}`} />
        </button>
        {options && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>{t("transcribe.provider")}</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className={select}>
                {PROVIDER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`providers.${id}.name`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>{t("recorder.audioLanguage")}</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={select}>
                {AUDIO_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {t(`audioLanguages.${l.key}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t("consent.title", { provider: name })}
        actions={
          <>
            <button type="button" onClick={() => setAsking(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              {t("common.cancel")}
            </button>
            <button type="button" autoFocus onClick={accept} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              {t("consent.accept")}
            </button>
          </>
        }
      >
        <p>{t("consent.body", { provider: name, where: t(`providers.${provider}.where`) })}</p>
        <p>{t(`providers.${provider}.privacy`)}</p>
        <p>{t("consent.others")}</p>
        <p className="text-xs text-slate-500">{t("consent.revoke", { provider: name })}</p>
      </Dialog>
    </section>
  );
}
