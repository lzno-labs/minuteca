import { useMemo, useState } from "react";
import { Search, Pencil, Trash2, Check, X, FileAudio, Mic } from "lucide-react";
import { formatDuration } from "../lib/format";
import { useI18n } from "../i18n";

export default function MeetingHistory({ meetings, selectedId, onSelect, onNew, onRename, onDelete, recording }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        Object.values(m.speakerNames || {}).some((n) => n.toLowerCase().includes(q)),
    );
  }, [meetings, query]);

  const commitRename = (id) => {
    const title = draft.trim();
    if (title) onRename(id, title);
    setEditingId(null);
  };

  return (
    <nav className="flex h-full flex-col" aria-label={t("history.label")}>
      <div className="space-y-3 p-4">
        <button
          type="button"
          onClick={onNew}
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition ${
            selectedId === null
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
          }`}
        >
          <Mic className="h-4 w-4" />
          {recording ? t("history.recordingInProgress") : t("history.newRecording")}
          {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("history.search")}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {meetings.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            {t("history.empty")}
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">{t("history.noMatch", { query })}</p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((m) => {
              const active = m.id === selectedId;
              return (
                <li key={m.id}>
                  {editingId === m.id ? (
                    <form
                      className="flex items-center gap-1 rounded-lg bg-white p-2 ring-2 ring-indigo-300"
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
                        className="min-w-0 flex-1 rounded px-1 text-sm focus:outline-none"
                        aria-label={t("meeting.title")}
                      />
                      <button type="submit" className="rounded p-1 text-emerald-600 hover:bg-emerald-50" aria-label={t("history.saveTitle")}>
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded p-1 text-slate-500 hover:bg-slate-100"
                        aria-label={t("common.cancel")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <div
                      className={`group flex items-center rounded-lg transition ${
                        active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(m.id)}
                        className="min-w-0 flex-1 px-3 py-2 text-left"
                        aria-current={active ? "page" : undefined}
                      >
                        <div className={`truncate text-sm font-medium ${active ? "text-indigo-900" : "text-slate-800"}`}>
                          {m.title}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          {new Date(m.date).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
                          <span aria-hidden>·</span>
                          {formatDuration(m.duration)}
                          {m.hasAudio && <FileAudio className="h-3 w-3" aria-label={t("history.audioSaved")} />}
                          {m.status !== "done" && (
                            <span className={m.status === "error" ? "text-rose-600" : "text-indigo-600"}>· {t(`history.status.${m.status}`)}</span>
                          )}
                          {daysLeft(m.expiresAt) <= 5 && (
                            <span className="text-amber-600">
                              · {t("meeting.expiresSoon", { count: Math.max(1, daysLeft(m.expiresAt)) })}
                            </span>
                          )}
                        </div>
                      </button>
                      <div className="flex shrink-0 pr-1 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(m.title);
                            setEditingId(m.id);
                          }}
                          className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-slate-800"
                          aria-label={t("history.rename", { title: m.title })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t("meeting.deleteConfirm", { title: m.title }))) onDelete(m.id);
                          }}
                          className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-rose-600"
                          aria-label={t("history.delete", { title: m.title })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="border-t border-slate-200 px-4 py-2 text-center text-xs text-slate-400" title={t("meeting.retention")}>
        {t("history.retentionNote")}
      </p>
    </nav>
  );
}

/** Whole days until a meeting is deleted (Infinity if unknown). */
function daysLeft(expiresAt) {
  if (!expiresAt) return Infinity;
  return Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
}
