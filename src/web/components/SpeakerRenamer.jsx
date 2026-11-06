import { useState } from "react";
import { Loader2, Sparkles, Users } from "lucide-react";
import { api } from "../lib/api";
import { llmMissing } from "../lib/llm";
import { useLlmConsent } from "./LlmConsent";
import { defaultSpeakerName, formatDuration, speakerStats } from "../lib/format";
import { speakerColor } from "./speakerColors";
import { useI18n } from "../i18n";

/**
 * One input per detected speaker. Typing a name updates the transcript and
 * all exports immediately. Giving two speakers the same name merges them.
 */
export default function SpeakerRenamer({ meetingId, me, onMeChange, onOpenSettings, utterances, speakerNames, onChange }) {
  const { t } = useI18n();
  const stats = speakerStats(utterances);
  const total = stats.reduce((n, s) => n + s.seconds, 0) || 1;
  const { ensure, dialog } = useLlmConsent(me, onMeChange);
  const [suggestions, setSuggestions] = useState(null); // { [speaker]: { name, evidence } }
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const ready = me && !llmMissing(me);

  const suggest = async () => {
    if (!ready) return onOpenSettings?.();
    if (!(await ensure())) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api(`/meetings/${meetingId}/speakers/suggest`, { method: "POST" });
      const map = Object.fromEntries(r.suggestions.map((s) => [s.speaker, s]));
      setSuggestions(map);
      if (!r.suggestions.length) setNote(t("speakers.noSuggestions"));
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  };
  const applyAll = () => {
    const next = { ...speakerNames };
    for (const [k, v] of Object.entries(suggestions || {})) next[k] = v.name;
    onChange(next);
    setSuggestions(null);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <Users className="h-4 w-4 text-slate-500" /> {t("speakers.title")}
        </h2>
        {stats.length > 0 && me && (
          <button
            type="button"
            onClick={suggest}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
            title={t("speakers.suggestHint")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {t("speakers.suggest")}
          </button>
        )}
      </div>
      <p className="-mt-1 mb-3 text-xs text-slate-500">{t("speakers.tip")}</p>
      {note && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{note}</p>}
      {suggestions && Object.keys(suggestions).length > 1 && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
          <span>{t("speakers.suggestionsReady", { provider: t(`llmProviders.${me.llm.provider}.name`) })}</span>
          <button type="button" onClick={applyAll} className="shrink-0 font-semibold hover:underline">
            {t("speakers.useAll")}
          </button>
        </div>
      )}
      {stats.length === 0 ? (
        <p className="text-sm text-slate-500">{t("speakers.none")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {stats.map((s) => {
            const c = speakerColor(s.speaker);
            const id = `speaker-${s.speaker}`;
            return (
              <li key={s.speaker} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
                <label htmlFor={id} className={`mb-1 flex items-center justify-between text-xs font-medium ${c.text}`}>
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                    {defaultSpeakerName(s.speaker)}
                  </span>
                  <span className="font-normal text-slate-500">
                    {formatDuration(s.seconds)} · {Math.round((s.seconds / total) * 100)}%
                  </span>
                </label>
                <input
                  id={id}
                  value={speakerNames?.[s.speaker] ?? ""}
                  onChange={(e) => onChange({ ...speakerNames, [s.speaker]: e.target.value })}
                  placeholder={t("speakers.placeholder", { speaker: defaultSpeakerName(s.speaker) })}
                  className="w-full rounded-lg border border-slate-200 bg-surface px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                {suggestions?.[s.speaker] && suggestions[s.speaker].name !== speakerNames?.[s.speaker] && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...speakerNames, [s.speaker]: suggestions[s.speaker].name })}
                    title={suggestions[s.speaker].evidence}
                    className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
                  >
                    <Sparkles className="h-3 w-3 shrink-0" /> {t("speakers.useSuggestion", { name: suggestions[s.speaker].name })}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </section>
  );
}
