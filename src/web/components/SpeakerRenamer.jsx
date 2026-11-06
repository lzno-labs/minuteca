import { Users } from "lucide-react";
import { defaultSpeakerName, formatDuration, speakerStats } from "../lib/format";
import { speakerColor } from "./speakerColors";
import { useI18n } from "../i18n";

/**
 * One input per detected speaker. Typing a name updates the transcript and
 * all exports immediately. Giving two speakers the same name merges them.
 */
export default function SpeakerRenamer({ utterances, speakerNames, onChange }) {
  const { t } = useI18n();
  const stats = speakerStats(utterances);
  const total = stats.reduce((n, s) => n + s.seconds, 0) || 1;

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <Users className="h-4 w-4 text-slate-500" /> {t("speakers.title")}
        </h2>
        <span className="hidden text-xs text-slate-500 sm:inline">{t("speakers.tip")}</span>
      </div>
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
