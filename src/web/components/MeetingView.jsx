import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileAudio, Loader2, MoreHorizontal, Smartphone, Trash2 } from "lucide-react";
import { audioUrl, getAudioBlob, refreshMeetings, removeMeetingAudio, updateMeetingMeta, updateSpeakers, useMeeting } from "../lib/cloud";
import { convertMeeting } from "../lib/convert";
import { audioExtension, fileBaseName, formatDuration } from "../lib/format";
import { downloadBlob } from "../lib/browser";
import { useI18n } from "../i18n";
import ExportToolbar from "./ExportToolbar";
import SpeakerRenamer from "./SpeakerRenamer";
import TranscriptViewer from "./TranscriptViewer";
import TranscribePanel from "./TranscribePanel";
import MinutesPanel from "./MinutesPanel";
import Menu from "./Menu";
import { useConfirm } from "./Confirm";

const SAVE_DELAY_MS = 400;

/**
 * Mount with key={meetingId}: local drafts are per meeting and pending edits are flushed to the
 * server on unmount.
 */
export default function MeetingView({ meetingId, onDelete, me, onMeChange, onOpenSettings, settings }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [stored, reload] = useMeeting(meetingId);
  const [draft, setDraft] = useState({});
  const [localUtterances, setLocalUtterances] = useState(null);
  const pending = useRef({});
  const timer = useRef(null);
  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(-1);
  const [tab, setTab] = useState(null); // "transcript" | "minutes"; null = minutes if they exist

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
  const date = new Date(meeting.date);
  const expiresIn = meeting.expiresAt ? Math.ceil((meeting.expiresAt.getTime() - Date.now()) / 86_400_000) : null;

  const removeAudio = async () => {
    if (await confirm({ title: t("exportBar.removeAudio"), body: t("exportBar.removeAudioConfirm"), confirmLabel: t("exportBar.removeAudio"), danger: true })) {
      await removeMeetingAudio(meetingId);
      reload();
      refreshMeetings();
    }
  };
  const remove = async () => {
    if (await confirm({ title: t("meeting.delete"), body: t("meeting.deleteConfirm", { title: meeting.title }), confirmLabel: t("meeting.deleteShort"), danger: true })) {
      onDelete(meetingId);
    }
  };
  const downloadAudio = async () => {
    const blob = await getAudioBlob(meetingId);
    downloadBlob(blob, `${fileBaseName(meeting.title)}.${audioExtension(meeting.audioType || blob.type)}`);
  };

  const meta = [
    date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }) + ", " + date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
    meeting.duration > 0 ? formatDuration(meeting.duration) : null,
  ].filter(Boolean);
  const footnote = [
    done && meeting.provider ? t("meeting.transcribedBy", { provider: t(`providers.${meeting.provider}.name`) }) : null,
    expiresIn !== null ? t("meeting.expires", { date: meeting.expiresAt.toLocaleDateString(locale, { day: "numeric", month: "long" }) }) : null,
  ].filter(Boolean);

  const player = meeting.hasAudio && (
    <audio
      ref={audioRef}
      src={audioUrl(meetingId)}
      controls
      preload="metadata"
      className="h-10 w-full"
      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
    />
  );

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-start gap-2">
          <input
            value={meeting.title}
            onChange={(e) => edit({ title: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && edit({ title: t("meeting.untitled") })}
            className="-mx-2 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-bold tracking-tight text-slate-900 hover:border-slate-200 focus:border-indigo-400 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:text-2xl"
            aria-label={t("meeting.title")}
          />
          <Menu
            label={t("meeting.more")}
            icon={MoreHorizontal}
            items={[
              { label: t("exportBar.audioFile"), icon: FileAudio, onClick: downloadAudio, hidden: !meeting.hasAudio },
              { label: t("exportBar.removeAudio"), icon: Trash2, onClick: removeAudio, hidden: !meeting.hasAudio || !done },
              meeting.hasAudio ? "divider" : null,
              { label: t("meeting.delete"), icon: Trash2, onClick: remove, danger: true },
            ]}
          />
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
          {meeting.source === "ios" && <Smartphone className="h-3.5 w-3.5" aria-label={t("meeting.fromIos")} />}
          <span>{meta.join(" · ")}</span>
        </p>
        {footnote.length > 0 && (
          <p className={`text-xs ${expiresIn !== null && expiresIn <= 5 ? "text-amber-700" : "text-slate-400"}`} title={t("meeting.retention")}>
            {footnote.join(" · ")}
          </p>
        )}
      </header>

      {converting && (
        <section className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900" role="status">
          {convertError ? (
            <span className="text-rose-700">{convertError}</span>
          ) : (
            <>
              <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> {t("transcribe.converting")}
            </>
          )}
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
      {meeting.status === "created" && <p className="rounded-2xl bg-amber-50 p-5 text-sm text-amber-900">{t("meeting.waitingAudio")}</p>}
      {!done && player}

      {done && (
        <>
          <div role="tablist" aria-label={t("meeting.views")} className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {[
              ["transcript", t("transcript.title")],
              ["minutes", t("minutes.title")],
            ].map(([id, label]) => {
              const active = (tab ?? (meeting.minutes ? "minutes" : "transcript")) === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-surface text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {(tab ?? (meeting.minutes ? "minutes" : "transcript")) === "minutes" ? (
            <MinutesPanel meeting={meeting} me={me} onMeChange={onMeChange} onChanged={reload} onOpenSettings={onOpenSettings} />
          ) : (
            <>
              <ExportToolbar meeting={meeting} onDownloadAudio={() => getAudioBlob(meetingId)} />
              <SpeakerRenamer
                meetingId={meetingId}
                me={me}
                onMeChange={onMeChange}
                onOpenSettings={onOpenSettings}
                utterances={meeting.utterances}
                speakerNames={meeting.speakerNames}
                onChange={(speakerNames) => edit({ speakerNames })}
              />
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
          {player && (
            <div className="pb-safe sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-surface/95 px-4 pt-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:pb-2 sm:shadow-lg">
              {player}
            </div>
          )}
        </>
      )}
    </div>
  );
}
