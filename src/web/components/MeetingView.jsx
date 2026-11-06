import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Clock, Cpu, Hourglass, Languages, Loader2, Smartphone, Trash2 } from "lucide-react";
import { audioUrl, getAudioBlob, refreshMeetings, removeMeetingAudio, updateMeetingMeta, updateSpeakers, useMeeting } from "../lib/cloud";
import { convertMeeting } from "../lib/convert";
import { formatDuration } from "../lib/format";
import { useI18n } from "../i18n";
import ExportToolbar from "./ExportToolbar";
import SpeakerRenamer from "./SpeakerRenamer";
import TranscriptViewer from "./TranscriptViewer";
import TranscribePanel from "./TranscribePanel";

const SAVE_DELAY_MS = 400;

/**
 * Mount with key={meetingId}: local drafts are per meeting and pending edits are flushed to the
 * server on unmount.
 */
export default function MeetingView({ meetingId, onDelete, me, onMeChange, onOpenSettings, settings }) {
  const { t, locale } = useI18n();
  const [stored, reload] = useMeeting(meetingId);
  const [draft, setDraft] = useState({});
  const [localUtterances, setLocalUtterances] = useState(null);
  const pending = useRef({});
  const timer = useRef(null);
  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(-1);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const changes = pending.current;
    pending.current = {};
    if (Object.keys(changes).length) {
      updateMeetingMeta(meetingId, changes)
        .then(refreshMeetings)
        .catch((err) => console.error("Could not save changes", err));
    }
  }, [meetingId]);

  useEffect(() => flush, [flush]);

  // The provider answered and the server left the conversion to the browser: do it now.
  const [convertError, setConvertError] = useState(null);
  const converting = stored?.status === "converting";
  useEffect(() => {
    if (!converting) return;
    setConvertError(null);
    convertMeeting(stored)
      .then(() => {
        reload();
        refreshMeetings();
      })
      .catch((err) => setConvertError(err.message));
    // Runs once per meeting reaching "converting".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [converting, meetingId]);

  const edit = (changes) => {
    setDraft((d) => ({ ...d, ...changes }));
    pending.current = { ...pending.current, ...changes };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const meeting = useMemo(
    () => (stored ? { ...stored, ...draft, utterances: localUtterances ?? stored.utterances } : stored),
    [stored, draft, localUtterances],
  );

  const utterances = meeting?.utterances;
  const activeIndex = useMemo(() => {
    if (!utterances || currentTime < 0) return -1;
    return utterances.findIndex((u) => currentTime >= u.start && currentTime < u.end + 0.5);
  }, [utterances, currentTime]);

  const onReassign = useCallback(
    (index, speaker) => {
      if (!utterances) return;
      const next = utterances.map((u, i) => (i === index ? { ...u, speaker } : u));
      setLocalUtterances(next);
      updateSpeakers(meetingId, next).catch((err) => console.error("Could not save speaker", err));
    },
    [utterances, meetingId],
  );

  const onSeek = useCallback((time) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = time;
    a.play().catch(() => {});
  }, []);

  if (stored === null) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!stored) return <p className="p-8 text-center text-slate-500">{t("meeting.notFound")}</p>;

  const done = meeting.status === "done";

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <div className="flex items-start gap-3">
          <input
            value={meeting.title}
            onChange={(e) => edit({ title: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && edit({ title: t("meeting.untitled") })}
            className="-mx-2 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-bold tracking-tight text-slate-900 hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:text-2xl"
            aria-label={t("meeting.title")}
          />
          <button
            type="button"
            onClick={() => confirm(t("meeting.deleteConfirm", { title: meeting.title })) && onDelete(meetingId)}
            className="mt-1.5 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            aria-label={t("meeting.delete")}
            title={t("meeting.delete")}
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            {new Date(meeting.date).toLocaleString(locale, { dateStyle: "full", timeStyle: "short" })}
          </span>
          {meeting.duration > 0 && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatDuration(meeting.duration)}
            </span>
          )}
          {meeting.language && (
            <span className="flex items-center gap-1.5">
              <Languages className="h-4 w-4" />
              {meeting.language}
            </span>
          )}
          {meeting.source === "ios" && (
            <span className="flex items-center gap-1.5">
              <Smartphone className="h-4 w-4" />
              {t("meeting.fromIos")}
            </span>
          )}
          {done && meeting.provider && (
            <span className="flex items-center gap-1.5" title={t("meeting.providerHint")}>
              <Cpu className="h-4 w-4" />
              {t("meeting.transcribedBy", { provider: t(`providers.${meeting.provider}.name`) })}
            </span>
          )}
          {meeting.expiresAt && (
            <span className="flex items-center gap-1.5" title={t("meeting.retention")}>
              <Hourglass className="h-4 w-4" />
              {t("meeting.expires", { date: meeting.expiresAt.toLocaleDateString(locale, { day: "numeric", month: "long" }) })}
            </span>
          )}
        </div>
        <ExportToolbar
          meeting={meeting}
          onDownloadAudio={() => getAudioBlob(meetingId)}
          onRemoveAudio={() => removeMeetingAudio(meetingId).then(() => {
            reload();
            refreshMeetings();
          })}
        />
        {meeting.hasAudio && (
          <audio
            ref={audioRef}
            src={audioUrl(meetingId)}
            controls
            preload="metadata"
            className="w-full"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          />
        )}
      </header>

      {converting && (
        <section className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900" role="status">
          {convertError ? <span className="text-rose-700">{convertError}</span> : <><Loader2 className="h-5 w-5 shrink-0 animate-spin" /> {t("transcribe.converting")}</>}
        </section>
      )}
      {!done && !converting && meeting.status !== "created" && (
        <TranscribePanel
          meeting={meeting}
          me={me}
          settings={settings}
          onMeChange={onMeChange}
          onOpenSettings={onOpenSettings}
          onStarted={() => {
            reload();
            refreshMeetings();
          }}
        />
      )}
      {meeting.status === "created" && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t("meeting.waitingAudio")}</p>}

      {done && (
        <>
          <SpeakerRenamer utterances={meeting.utterances} speakerNames={meeting.speakerNames} onChange={(speakerNames) => edit({ speakerNames })} />
          <TranscriptViewer
            utterances={meeting.utterances}
            speakerNames={meeting.speakerNames}
            onReassign={onReassign}
            onSeek={meeting.hasAudio ? onSeek : undefined}
            activeIndex={activeIndex}
            forceHours={(meeting.duration || 0) >= 3600}
          />
        </>
      )}
    </div>
  );
}
