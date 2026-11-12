import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { api } from "../lib/api";
import { useI18n } from "../i18n";

/**
 * Runs a meeting's automatic steps (names, then minutes) once its transcript is here, when the
 * person turned them on in Settings (docs/design/automatic-minutes-and-revisions.md). The server
 * hands each step out once, so another tab or a reload never pays twice.
 *
 * const auto = useAutoSteps({ meeting, me, reload, beforeNames, afterNames });
 * auto.running: "names" | "minutes" | null; auto.names: the names step's answer; <AutoStatus auto={auto} />
 */
export function useAutoSteps({ meeting, me, reload, beforeNames, afterNames }) {
  const [running, setRunning] = useState(null);
  const [names, setNames] = useState(null);
  const [minutesDone, setMinutesDone] = useState(false);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(false);
  const started = useRef(new Set());
  const stopped = useRef(false);
  const pending = meeting?.status === "done" ? (meeting.autoPending ?? []) : [];
  // One step at a time: the next one starts once the reload after the last brings the new state.
  const next = running || error || stopped.current ? null : pending.find((s) => !started.current.has(`${meeting.id}:${s}`));

  useEffect(() => {
    if (!next || !me) return;
    started.current.add(`${meeting.id}:${next}`);
    setRunning(next);
    setHidden(false);
    (async () => {
      try {
        if (next === "names") {
          beforeNames?.();
          const r = await api(`/meetings/${meeting.id}/speakers/suggest`, { method: "POST", body: { auto: true } });
          if (!r.skipped) {
            setNames(r);
            afterNames?.(r);
          }
        } else {
          const r = await api(`/meetings/${meeting.id}/minutes`, { method: "POST", body: { auto: true } });
          if (!r.skipped) setMinutesDone(true);
        }
        await reload();
        setRunning(null);
      } catch (err) {
        setRunning(null);
        setError(err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, meeting?.id]);

  const stop = async () => {
    stopped.current = true;
    try {
      await api(`/meetings/${meeting.id}/auto`, { method: "DELETE" });
    } catch {
      // The step on its way still finishes; nothing else starts in this view.
    }
    setHidden(true);
  };

  return { running, names, minutesDone, error, hidden, provider: me?.llm?.provider, stop, close: () => setHidden(true) };
}

/** What the automatic steps are doing, and what they did, said plainly (they use AI). */
export function AutoStatus({ auto }) {
  const { t } = useI18n();
  if (auto.hidden) return null;
  const provider = auto.provider ? t(`llmProviders.${auto.provider}.name`) : "";
  const closeButton = (
    <button type="button" onClick={auto.close} aria-label={t("common.close")} className="shrink-0 rounded-lg p-1 opacity-70 hover:opacity-100">
      <X className="h-4 w-4" />
    </button>
  );

  if (auto.running) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-900" role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t(`auto.${auto.running}`, { provider })}</p>
          <p className="text-xs text-indigo-700">{t("auto.why")}</p>
        </div>
        <button type="button" onClick={auto.stop} className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
          {t("auto.stop")}
        </button>
      </section>
    );
  }
  if (auto.error) {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">{t("auto.failed", { reason: auto.error })}</p>
        {closeButton}
      </section>
    );
  }
  if (!auto.names && !auto.minutesDone) return null;
  const applied = Object.values(auto.names?.applied ?? {});
  return (
    <section className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {auto.names && <p>{applied.length ? t("auto.namesDone", { names: applied.join(", ") }) : t("auto.namesNone")}</p>}
        {auto.minutesDone && <p>{t("auto.minutesDone")}</p>}
      </div>
      {closeButton}
    </section>
  );
}
