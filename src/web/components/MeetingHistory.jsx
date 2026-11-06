import { useMemo, useState } from "react";
import { Check, Mic, Pencil, Search, Smartphone, Trash2, X } from "lucide-react";
import { formatDuration } from "../lib/format";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";

const NEEDS_ACTION = new Set(["uploaded", "error", "converting", "transcribing", "created"]);

function daysLeft(expiresAt) {
  if (!expiresAt) return Infinity;
  return Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
}

/** Short state label for the list; nothing for a finished meeting that is not about to expire. */
export function StatusPill({ meeting }) {
  const { t } = useI18n();
  const left = daysLeft(meeting.expiresAt);
  const styles = {
    uploaded: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    converting: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    transcribing: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    created: "bg-slate-100 text-slate-600 ring-slate-200",
    error: "bg-rose-50 text-rose-700 ring-rose-200",
  };
  if (meeting.status !== "done") {
    return (
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${styles[meeting.status] || styles.created}`}>
        {meeting.status === "transcribing" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />}
        {t(`history.status.${meeting.status}`)}
      </span>
    );
  }
  if (left <= 5) {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
        {t("meeting.expiresSoon", { count: Math.max(1, left) })}
      </span>
    );
  }
  return null;
}

export default function MeetingHistory({ meetings, selectedId, onSelect, onNew, onRename, onDelete, recording }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) => m.title.toLowerCase().includes(q) || Object.values(m.speakerNames || {}).some((n) => n.toLowerCase().includes(q)));
  }, [meetings, query]);
  const pending = filtered.filter((m) => NEEDS_ACTION.has(m.status));
  const rest = filtered.filter((m) => !NEEDS_ACTION.has(m.status));

  const shortDate = (iso) => {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  };

  const commitRename = (id) => {
    const title = draft.trim();
    if (title) onRename(id, title);
    setEditingId(null);
  };

  const remove = async (m) => {
    if (await confirm({ title: t("meeting.delete"), body: t("meeting.deleteConfirm", { title: m.title }), confirmLabel: t("meeting.deleteShort"), danger: true })) {
      onDelete(m.id);
    }
  };

  const row = (m) => {
    const active = m.id === selectedId;
    if (editingId === m.id) {
      return (
        <li key={m.id}>
          <form
            className="flex items-center gap-1 rounded-lg bg-surface p-2 ring-2 ring-indigo-300"
            onSubmit={(e) => {
              e.preventDefault();
              commitRename(m.id);
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
              className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm focus:outline-none"
              aria-label={t("meeting.title")}
            />
            <button type="submit" className="rounded p-1 text-emerald-600 hover:bg-emerald-50" aria-label={t("history.saveTitle")}>
              <Check className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={t("common.cancel")}>
              <X className="h-4 w-4" />
            </button>
          </form>
        </li>
      );
    }
    return (
      <li key={m.id}>
        <div className={`group flex items-center rounded-lg transition ${active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-100"}`}>
          <button type="button" onClick={() => onSelect(m.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left" aria-current={active ? "page" : undefined}>
            <span className={`block truncate text-sm font-medium ${active ? "text-indigo-900" : "text-slate-800"}`}>{m.title}</span>
            <span className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">
              {m.source === "ios" && <Smartphone className="h-3 w-3 shrink-0" aria-label={t("meeting.fromIos")} />}
              {shortDate(m.date)}
              {m.duration > 0 && (
                <>
                  <span aria-hidden>·</span>
                  {formatDuration(m.duration)}
                </>
              )}
              <span className="ml-auto pl-1">
                <StatusPill meeting={m} />
              </span>
            </span>
          </button>
          <div className="hidden shrink-0 pr-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 can-hover:flex">
            <button
              type="button"
              onClick={() => {
                setDraft(m.title);
                setEditingId(m.id);
              }}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label={t("history.rename", { title: m.title })}
              title={t("history.rename", { title: m.title })}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => remove(m)}
              className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              aria-label={t("history.delete", { title: m.title })}
              title={t("history.delete", { title: m.title })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </li>
    );
  };

  const group = (label, list) =>
    list.length > 0 && (
      <section className="mt-2 first:mt-0">
        <h3 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</h3>
        <ul className="space-y-0.5">{list.map(row)}</ul>
      </section>
    );

  return (
    <nav className="flex h-full flex-col" aria-label={t("history.label")}>
      <div className="space-y-3 p-4">
        <button
          type="button"
          onClick={onNew}
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition ${
            selectedId === null ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border border-slate-200 bg-surface text-slate-800 hover:bg-slate-50"
          }`}
        >
          <Mic className="h-4 w-4" />
          {recording ? t("history.recordingInProgress") : t("history.newRecording")}
          {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
        </button>
        {meetings.length > 3 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("history.search")}
              aria-label={t("history.search")}
              className="w-full rounded-lg border border-slate-200 bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {meetings.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">{t("history.empty")}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">{t("history.noMatch", { query })}</p>
        ) : (
          <>
            {group(t("history.pending"), pending)}
            {group(t("history.meetings"), rest)}
          </>
        )}
      </div>

      <p className="border-t border-slate-200 px-4 py-2 text-center text-xs text-slate-400" title={t("meeting.retention")}>
        {t("history.retentionNote")}
      </p>
    </nav>
  );
}
