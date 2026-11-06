import { memo, useMemo, useState } from "react";
import { Search, FileText } from "lucide-react";
import { defaultSpeakerName, formatClock, speakerName, speakerStats } from "../lib/format";
import { speakerColor } from "./speakerColors";
import { useI18n } from "../i18n";

function highlight(text, query) {
  if (!query) return text;
  const q = query.toLowerCase();
  const parts = [];
  let i = 0;
  let idx;
  const lower = text.toLowerCase();
  while ((idx = lower.indexOf(q, i)) !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={idx} className="rounded bg-yellow-200 px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  parts.push(text.slice(i));
  return parts;
}

/**
 * Speaker-labelled transcript. Names update live from speakerNames. Each
 * block's speaker can be reassigned to fix diarization mistakes, and
 * timestamps seek the audio player when audio was kept.
 */
export default function TranscriptViewer({ utterances, speakerNames, onReassign, onSeek, activeIndex, forceHours }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const speakers = useMemo(() => speakerStats(utterances).map((s) => s.speaker).sort((a, b) => a - b), [utterances]);
  const nextSpeaker = speakers.length ? Math.max(...speakers) + 1 : 0;
  const q = query.trim();
  const matches = q ? utterances.filter((u) => u.text.toLowerCase().includes(q.toLowerCase())).length : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-slate-500" /> {t("transcript.title")}
        </h2>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("transcript.find")}
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-9 pr-16 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {q && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{t("transcript.found", { count: matches })}</span>}
        </div>
      </div>

      {utterances.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">{t("transcript.empty")}</p>
      ) : (
        <ol className="divide-y divide-slate-50">
          {utterances.map((u, i) => (
            <Block
              key={i}
              index={i}
              u={u}
              name={speakerName(speakerNames, u.speaker)}
              query={q}
              dimmed={q && !u.text.toLowerCase().includes(q.toLowerCase())}
              active={i === activeIndex}
              editing={editing === i}
              setEditing={setEditing}
              speakers={speakers}
              nextSpeaker={nextSpeaker}
              speakerNames={speakerNames}
              onReassign={onReassign}
              onSeek={onSeek}
              forceHours={forceHours}
              lang={lang}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

const Block = memo(function Block({
  index,
  u,
  name,
  query,
  dimmed,
  active,
  editing,
  setEditing,
  speakers,
  nextSpeaker,
  speakerNames,
  onReassign,
  onSeek,
  forceHours,
  // `lang` is passed only so memo re-renders this block when the UI language changes.
}) {
  const { t } = useI18n();
  const c = speakerColor(u.speaker);
  return (
    <li
      className={`flex gap-3 px-4 py-3 transition sm:gap-4 sm:px-5 ${active ? "bg-indigo-50/60" : ""} ${
        dimmed ? "opacity-40" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onSeek?.(u.start)}
        disabled={!onSeek}
        className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-slate-400 enabled:hover:text-indigo-600 disabled:cursor-default"
        title={onSeek ? t("transcript.playFromHere") : undefined}
      >
        {formatClock(u.start, forceHours)}
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <select
            autoFocus
            value={u.speaker}
            onChange={(e) => {
              onReassign(index, Number(e.target.value));
              setEditing(null);
            }}
            onBlur={() => setEditing(null)}
            className="mb-1 rounded-md border border-slate-300 px-2 py-0.5 text-sm"
            aria-label={t("transcript.reassign")}
          >
            {speakers.map((s) => (
              <option key={s} value={s}>
                {speakerName(speakerNames, s)}
              </option>
            ))}
            <option value={nextSpeaker}>{t("transcript.newSpeaker", { name: defaultSpeakerName(nextSpeaker) })}</option>
          </select>
        ) : (
          <button
            type="button"
            onClick={() => onReassign && setEditing(index)}
            className={`mb-0.5 flex items-center gap-1.5 text-sm font-semibold ${c.text} hover:underline`}
            title={t("transcript.wrongSpeaker")}
          >
            <span className={`h-2 w-2 rounded-full ${c.dot}`} />
            {name}
          </button>
        )}
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{highlight(u.text, query)}</p>
      </div>
    </li>
  );
});
