import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Languages, Loader2, LogOut, Menu as MenuIcon, Mic, Settings, Users, X } from "lucide-react";
import { useAuth } from "./hooks/useAuth";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { assembleSessionAudio, db, deleteSession, findUnfinalizedSessions } from "./lib/db";
import { deleteMeeting, refreshMeetings, startTranscription, updateMeetingMeta, useMeetings } from "./lib/cloud";
import { audioDuration, uploadMeeting } from "./lib/transcribe";
import { audioExtension, defaultMeetingTitle } from "./lib/format";
import { audioMimeType, titleFromFileName } from "./lib/audioFile";
import { downloadBlob, isIosBrowser, loadSettings, saveSettings } from "./lib/browser";
import { keySource, usableProvider } from "./lib/providers";
import LoginScreen, { AccessScreen } from "./components/LoginScreen";
import DownloadScreen from "./components/DownloadScreen";
import Recorder from "./components/Recorder";
import RecoveryBanner from "./components/RecoveryBanner";
import TranscriptionStatus from "./components/TranscriptionStatus";
import MeetingHistory from "./components/MeetingHistory";
import MeetingView from "./components/MeetingView";
import ImportAudio from "./components/ImportAudio";
import LanguageSwitch from "./components/LanguageSwitch";
import UsersPanel from "./components/UsersPanel";
import SettingsPanel from "./components/SettingsPanel";
import InstallButton from "./components/InstallButton";
import UpdatePrompt from "./components/UpdatePrompt";
import Menu from "./components/Menu";
import { useConfirm } from "./components/Confirm";
import { takeSharedFile } from "./lib/shareTarget";
import { useI18n } from "./i18n";

export default function App() {
  const { t } = useI18n();
  const { me, loading, reload, signOut } = useAuth();

  useEffect(() => {
    document.title = t("app.documentTitle");
  }, [t]);

  if (window.location.pathname === "/acceso") return <AccessScreen />;
  if (window.location.pathname === "/descargar") return <DownloadScreen />;
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!me) return <LoginScreen />;
  return <Workspace me={me} onMeChange={reload} onSignOut={signOut} />;
}

const USERS_VIEW = "users";
const SETTINGS_VIEW = "settings";
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** /?m=<meeting id> opens that meeting (links from the iPhone recorder). */
function meetingFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("m");
  if (!id) return null;
  params.delete("m");
  const rest = params.toString();
  window.history.replaceState(null, "", rest ? `/?${rest}` : "/");
  return ID_RE.test(id) ? id : null;
}

function Workspace({ me, onMeChange, onSignOut }) {
  const { t } = useI18n();
  const recorder = useAudioRecorder();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState(meetingFromUrl); // null = recorder view
  const [job, setJob] = useState(null);
  const [settings, setSettings] = useState(loadSettings);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadedMeetings = useMeetings();
  const meetings = useMemo(() => loadedMeetings ?? [], [loadedMeetings]);
  const sessions = useLiveQuery(() => db.sessions.orderBy("startedAt").reverse().toArray(), [], []);

  // Drop empty staging sessions left by aborted starts.
  useEffect(() => {
    findUnfinalizedSessions().catch(() => {});
  }, []);

  // A recording whose meeting already has its audio on the server is safe there: drop the local backup.
  const uploadedIds = useMemo(() => new Set(meetings.filter((m) => m.hasAudio).map((m) => m.id)), [meetings]);
  useEffect(() => {
    for (const s of sessions) {
      if (uploadedIds.has(s.id) && !(recorder.isActive && s.id === recorder.sessionId)) deleteSession(s.id).catch(() => {});
    }
  }, [sessions, uploadedIds, recorder.isActive, recorder.sessionId]);

  const recoverable = useMemo(
    () =>
      sessions.filter(
        (s) => (s.chunkCount || 0) > 0 && !uploadedIds.has(s.id) && !(recorder.isActive && s.id === recorder.sessionId) && s.id !== job?.source?.sessionId,
      ),
    [sessions, uploadedIds, recorder.isActive, recorder.sessionId, job],
  );

  const updateSettings = (next) => {
    setSettings(next);
    saveSettings(next);
  };

  const provider = usableProvider(me);
  const destination = provider
    ? t(me.consents.includes(provider) ? "recorder.destinationAuto" : "recorder.destinationAsk", { provider: t(`providers.${provider}.name`) })
    : t("recorder.destinationNoKey");

  /**
   * Uploads a recording or an imported file, then transcribes it right away only if the person
   * already allowed this provider; otherwise the meeting view asks first.
   */
  const runUpload = useCallback(
    async (input) => {
      // A recording reuses its local session id as the meeting id, so a retry (even after a
      // reload) finds the same meeting instead of creating another.
      const source = { ...input, meetingId: input.meetingId || input.sessionId || crypto.randomUUID() };
      setJob({ source, phase: "uploading", progress: 0 });
      try {
        const audio = source.blob ? source : { sessionId: source.sessionId, ...(await assembleSessionAudio(source.sessionId)) };
        if (!audio.blob.size) throw new Error(t("app.emptyRecording"));
        const date = audio.startedAt || new Date().toISOString();
        const duration = audio.durationSec || (await audioDuration(audio.blob));
        await uploadMeeting(
          audio.blob,
          { id: source.meetingId, title: source.title || defaultMeetingTitle(new Date(date)), date, source: source.blob ? "import" : "web", duration },
          { maxBytes: me.maxAudioBytes, onProgress: (p) => setJob((j) => (j && !j.error ? { ...j, progress: p } : j)) },
        );
        if (source.sessionId) await deleteSession(source.sessionId);
        const p = usableProvider(me);
        if (p && me.consents.includes(p) && keySource(me, p)) {
          await startTranscription(source.meetingId, { provider: p, language: settings.language }).catch(() => {});
        }
        setJob(null);
        refreshMeetings();
        setSelectedId(source.meetingId);
      } catch (err) {
        setJob({ source, error: err?.message || String(err), retryable: err?.status !== 413 && err?.status !== 415 });
      }
    },
    [settings, me, t],
  );

  const handleImport = (file, mimeType) => {
    runUpload({
      // Re-typed slice: some browsers report "" for .amr/.opus etc.
      blob: file.slice(0, file.size, mimeType),
      mimeType,
      fileName: file.name,
      title: titleFromFileName(file.name),
      startedAt: new Date(file.lastModified || Date.now()).toISOString(),
    });
  };

  // Opened from Android's share sheet (see src/web/sw.js): import the shared file.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("shared")) return;
    window.history.replaceState(null, "", "/");
    takeSharedFile().then((file) => {
      const type = file && audioMimeType(file);
      if (type) {
        setSelectedId(null);
        handleImport(file, type);
      }
    });
    // Runs once on mount; handleImport only needs the initial settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = async () => {
    const result = await recorder.stop();
    if (result) runUpload(result);
  };

  const downloadSessionAudio = async (sessionId) => {
    const { blob, mimeType, startedAt } = await assembleSessionAudio(sessionId);
    const stamp = (startedAt || new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-");
    downloadBlob(blob, `recording-${stamp}.${audioExtension(mimeType)}`);
  };

  const select = (id) => {
    setSelectedId(id);
    setDrawerOpen(false);
  };

  const handleDeleteMeeting = async (id) => {
    if (selectedId === id) setSelectedId(null);
    await deleteMeeting(id);
    refreshMeetings();
  };

  const handleSignOut = async () => {
    if (recorder.isActive && !(await confirm({ title: t("app.signOut"), body: t("app.signOutConfirm"), confirmLabel: t("app.signOut") }))) return;
    recorder.stop().finally(onSignOut);
  };

  const sidebar = (
    <MeetingHistory
      meetings={meetings}
      selectedId={selectedId}
      onSelect={select}
      onNew={() => select(null)}
      onRename={(id, title) => updateMeetingMeta(id, { title }).then(refreshMeetings)}
      onDelete={handleDeleteMeeting}
      recording={recorder.isActive}
    />
  );

  const iconButton = (view, Icon, label) => (
    <button
      type="button"
      onClick={() => select(view)}
      className={`hidden rounded-lg p-2 hover:bg-slate-100 hover:text-slate-800 sm:inline-flex ${selectedId === view ? "bg-indigo-50 text-indigo-700" : "text-slate-500"}`}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-surface px-3 sm:px-4">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label={t("app.openHistory")}
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => select(null)} className="flex items-center gap-2 rounded-lg px-1 py-1" aria-label={t("app.home")}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Mic className="h-4 w-4" />
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">minuteca</span>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <InstallButton />
          {iconButton(SETTINGS_VIEW, Settings, t("settings.open"))}
          {me.role === "admin" && iconButton(USERS_VIEW, Users, t("users.open"))}
          <Menu
            label={t("app.account")}
            buttonClassName="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold uppercase text-indigo-700 hover:ring-2 hover:ring-indigo-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            items={[
              { content: <span className="block truncate font-medium text-slate-900">{me.email}</span> },
              "divider",
              { label: t("settings.open"), icon: Settings, onClick: () => select(SETTINGS_VIEW) },
              { label: t("users.open"), icon: Users, onClick: () => select(USERS_VIEW), hidden: me.role !== "admin" },
              {
                content: (
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2.5 text-slate-700">
                      <Languages className="h-4 w-4" /> {t("app.language")}
                    </span>
                    <LanguageSwitch />
                  </span>
                ),
              },
              "divider",
              { label: t("app.signOut"), icon: LogOut, onClick: handleSignOut },
            ]}
          >
            {me.email.slice(0, 1)}
          </Menu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-slate-50 lg:block">{sidebar}</aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
            <aside className="pb-safe absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-slate-50 shadow-xl">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" />
              </button>
              <div className="h-full pt-10">{sidebar}</div>
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
            {selectedId === USERS_VIEW ? (
              <UsersPanel currentEmail={me.email} onBack={() => select(null)} />
            ) : selectedId === SETTINGS_VIEW ? (
              <SettingsPanel me={me} onMeChange={onMeChange} onBack={() => select(null)} onSignOut={handleSignOut} />
            ) : selectedId === null ? (
              <>
                <TranscriptionStatus job={job} onRetry={() => runUpload(job.source)} onDismiss={() => setJob(null)} />
                <RecoveryBanner
                  sessions={recoverable}
                  busy={Boolean(job && !job.error) || recorder.isActive}
                  onRestore={(sessionId) => runUpload({ sessionId })}
                  onDownload={downloadSessionAudio}
                  onDiscard={deleteSession}
                />
                <Recorder
                  recorder={recorder}
                  onStop={handleStop}
                  settings={settings}
                  onSettingsChange={updateSettings}
                  disabled={Boolean(job && !job.error)}
                  destination={destination}
                  needsKey={!provider}
                  onOpenSettings={() => select(SETTINGS_VIEW)}
                  iosNotice={isIosBrowser() ? t("recorder.iosNotice") : null}
                />
                <ImportAudio onFile={handleImport} maxBytes={me.maxAudioBytes} disabled={recorder.isActive || Boolean(job && !job.error)} />
                <p className="text-center text-xs text-slate-400">{t("app.placementTip")}</p>
              </>
            ) : (
              <>
                {(recorder.isActive || (job && !job.error)) && (
                  <button
                    type="button"
                    onClick={() => select(null)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                    {recorder.isActive ? t("app.recordingBanner") : t("app.uploadingBanner")}
                  </button>
                )}
                <MeetingView
                  key={selectedId}
                  meetingId={selectedId}
                  onDelete={handleDeleteMeeting}
                  me={me}
                  onMeChange={onMeChange}
                  onOpenSettings={() => select(SETTINGS_VIEW)}
                  settings={settings}
                />
              </>
            )}
          </div>
        </main>
      </div>
      <UpdatePrompt busy={recorder.isActive || Boolean(job && !job.error)} />
    </div>
  );
}
