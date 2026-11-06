import { Mic, Pause, Play, Square, Loader2, AlertTriangle, HardDrive } from "lucide-react";
import AudioLevelMeter from "./AudioLevelMeter";
import { formatBytes, formatClock } from "../lib/format";
import { AUDIO_LANGUAGES } from "../lib/browser";
import { useI18n } from "../i18n";

export default function Recorder({ recorder, onStop, settings, onSettingsChange, disabled, destination, iosNotice }) {
  const { t } = useI18n();
  const { status, elapsedMs, bytes, analyser, error, warning, start, pause, resume, supportsSystemAudio } = recorder;
  const recording = status === "recording";
  const paused = status === "paused";
  const busy = status === "requesting" || status === "stopping";
  const live = recording || paused || status === "stopping";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-center gap-2 text-sm font-medium">
          {recording && (
            <span className="flex items-center gap-2 text-rose-600">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" /> {t("recorder.recording")}
            </span>
          )}
          {paused && <span className="text-amber-600">{t("recorder.paused")}</span>}
          {status === "stopping" && <span className="text-slate-500">{t("recorder.finishing")}</span>}
          {status === "idle" && <span className="text-slate-500">{t("recorder.ready")}</span>}
          {status === "requesting" && <span className="text-slate-500">{t("recorder.waitingMic")}</span>}
        </div>

        <div className="font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl" aria-live="off">
          {formatClock(elapsedMs / 1000, true)}
        </div>

        <AudioLevelMeter analyser={analyser} active={recording} />

        <div className="flex items-center gap-4">
          {!live ? (
            <button
              type="button"
              onClick={() => start(settings.audioSource || "microphoneOnly")}
              disabled={busy || disabled}
              className="relative flex h-20 w-20 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition hover:bg-rose-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t("recorder.start")}
            >
              {busy ? <Loader2 className="h-8 w-8 animate-spin" /> : <Mic className="h-8 w-8" />}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={paused ? resume : pause}
                disabled={busy}
                className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:opacity-50"
                aria-label={paused ? t("recorder.resume") : t("recorder.pause")}
                title={paused ? t("recorder.resumeShort") : t("recorder.pauseShort")}
              >
                {paused ? <Play className="h-6 w-6" /> : <Pause className="h-6 w-6" />}
              </button>
              <button
                type="button"
                onClick={onStop}
                disabled={busy}
                className="relative flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-300 disabled:opacity-50"
                aria-label={t("recorder.stop")}
                title={t("recorder.stopShort")}
              >
                {recording && <span className="animate-pulse-ring absolute inset-0 rounded-full bg-rose-500" />}
                {busy ? <Loader2 className="relative h-8 w-8 animate-spin" /> : <Square className="relative h-7 w-7 fill-current" />}
              </button>
            </>
          )}
        </div>

        {live ? (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <HardDrive className="h-3.5 w-3.5" />
            {t("recorder.autosaved", { size: formatBytes(bytes) })}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-slate-600">
            <label className="flex items-center gap-2">
              {t("recorder.audioLanguage")}
              <select
                value={settings.language}
                onChange={(e) => onSettingsChange({ ...settings, language: e.target.value })}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {AUDIO_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {t(`audioLanguages.${l.key}`)}
                  </option>
                ))}
              </select>
            </label>
            {supportsSystemAudio && (
              <label className="flex items-center gap-2">
                {t("recorder.audioSource")}
                <select
                  value={settings.audioSource || "microphoneOnly"}
                  onChange={(e) => onSettingsChange({ ...settings, audioSource: e.target.value })}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="microphoneOnly">{t("audioSources.microphoneOnly")}</option>
                  <option value="bothAudioSources">{t("audioSources.bothAudioSources")}</option>
                  <option value="systemAudioOnly">{t("audioSources.systemAudioOnly")}</option>
                </select>
              </label>
            )}
          </div>
        )}

        {!live && destination && <p className="max-w-md text-center text-xs text-slate-500">{destination}</p>}
        {!live && iosNotice && (
          <p className="flex max-w-md items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {iosNotice}
          </p>
        )}

        {(error || warning) && (
          <div
            role="alert"
            className={`flex w-full items-start gap-2 rounded-lg px-4 py-3 text-sm ${
              error ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"
            }`}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error || warning}</span>
          </div>
        )}
      </div>
    </section>
  );
}
