import { useState } from "react";
import { AlertTriangle, Loader2, Send, Settings } from "lucide-react";
import { api } from "../lib/api";
import { startTranscription } from "../lib/cloud";
import { AUDIO_LANGUAGES } from "../lib/browser";
import { keySource, PROVIDER_IDS, usableProvider } from "../lib/providers";
import { formatDuration } from "../lib/format";
import { useI18n } from "../i18n";
import Dialog from "./Dialog";

/**
 * Says where the audio will go and starts the transcription. The first time a person uses a
 * provider, it asks for permission (stored on the server; the server refuses without it).
 */
export default function TranscribePanel({ meeting, me, onMeChange, onStarted, onOpenSettings, settings }) {
  const { t } = useI18n();
  const [provider, setProvider] = useState(() => usableProvider(me) ?? me?.provider ?? "deepgram");
  const [language, setLanguage] = useState(settings?.language ?? "es");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const source = keySource(me, provider);
  const name = t(`providers.${provider}.name`);

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
      <section className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900" role="status">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
        <div>
          <p className="font-semibold">{t("transcribe.inProgress", { provider: t(`providers.${meeting.provider}.name`) })}</p>
          <p className="text-indigo-700">{t("status.usuallyFast")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      {meeting.status === "error" && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("transcribe.failed", { reason: t(`errors.${meeting.error}`) })}
        </p>
      )}
      <p className="text-sm font-semibold text-slate-800">
        {meeting.duration ? t("transcribe.readyWithLength", { duration: formatDuration(meeting.duration) }) : t("transcribe.ready")}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          {t("transcribe.provider")}
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1">
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`providers.${id}.name`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {t("recorder.audioLanguage")}
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1">
            {AUDIO_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {t(`audioLanguages.${l.key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {source ? (
        <p className="text-sm text-slate-600">
          {t("transcribe.destination", { provider: name, where: t(`providers.${provider}.where`) })}{" "}
          {t(source === "own" ? "transcribe.paidOwn" : "transcribe.paidHosted")}
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("transcribe.noKey", { provider: name })}{" "}
            <button type="button" onClick={onOpenSettings} className="inline-flex items-center gap-1 font-semibold underline">
              <Settings className="h-3.5 w-3.5" /> {t("settings.open")}
            </button>
          </span>
        </p>
      )}
      <button
        type="button"
        onClick={go}
        disabled={!source || busy}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {t(meeting.status === "error" ? "transcribe.retry" : "transcribe.start")}
      </button>
      {error && <p className="text-sm text-rose-700">{error}</p>}

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t("consent.title", { provider: name })}
        actions={
          <>
            <button type="button" onClick={() => setAsking(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={accept} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              {t("consent.accept")}
            </button>
          </>
        }
      >
        <p>{t("consent.body", { provider: name, where: t(`providers.${provider}.where`) })}</p>
        <p>{t(`providers.${provider}.privacy`)}</p>
        <p>{t("consent.others")}</p>
        <p className="text-xs text-slate-500">{t("consent.revoke")}</p>
      </Dialog>
    </section>
  );
}
