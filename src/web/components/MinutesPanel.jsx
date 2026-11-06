import { useState } from "react";
import { Check, Copy, Download, FileText, Loader2, Pencil, RotateCcw, Settings, Share2, Sparkles, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { llmMissing } from "../lib/llm";
import { markdownToText, renderMarkdown } from "../lib/markdown";
import { fileBaseName } from "../lib/format";
import { copyToClipboard, downloadText } from "../lib/browser";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";
import { useLlmConsent } from "./LlmConsent";
import Menu from "./Menu";

/**
 * The minutes of a meeting, written by the language model the person chose (with their own key),
 * then theirs to edit, copy, share or download. Always labelled as AI-generated.
 */
export default function MinutesPanel({ meeting, me, onMeChange, onChanged, onOpenSettings }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const { ensure, dialog } = useLlmConsent(me, onMeChange);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // draft text while editing
  const [copied, setCopied] = useState(false);
  const minutes = meeting.minutes;
  const missing = llmMissing(me);
  const provider = me.llm?.provider;
  const name = provider ? t(`llmProviders.${provider}.name`) : "";
  const base = `${fileBaseName(meeting.title)}_minuta`;

  const generate = async () => {
    if (minutes && !(await confirm({ title: t("minutes.regenerateTitle"), body: t(minutes.edited ? "minutes.regenerateEdited" : "minutes.regenerateBody"), confirmLabel: t("minutes.regenerate") }))) return;
    if (!(await ensure())) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meeting.id}/minutes`, { method: "POST" });
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meeting.id}/minutes`, { method: "PUT", body: { body: editing } });
      setEditing(null);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (await confirm({ title: t("minutes.deleteTitle"), body: t("minutes.deleteBody"), confirmLabel: t("meeting.deleteShort"), danger: true })) {
      await api(`/meetings/${meeting.id}/minutes`, { method: "DELETE" });
      await onChanged();
    }
  };

  const copy = async () => {
    if (await copyToClipboard(minutes.body)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const share = async () => {
    const data = { title: meeting.title, text: markdownToText(minutes.body) };
    if (navigator.canShare?.(data)) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    copy();
  };

  const card = "rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm";
  const secondary =
    "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-surface px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300";

  if (missing) {
    return (
      <section className={`${card} space-y-3`}>
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <Sparkles className="h-5 w-5 text-indigo-600" /> {t("minutes.title")}
        </h2>
        <p className="text-sm text-slate-600">{t(missing === "provider" ? "minutes.setupProvider" : "minutes.setupKey", { provider: name })}</p>
        <button type="button" onClick={onOpenSettings} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
          <Settings className="h-4 w-4" /> {t("minutes.openSettings")}
        </button>
      </section>
    );
  }

  if (busy && !editing) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-900" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
        <div>
          <p className="font-semibold">{t("minutes.writing", { provider: name })}</p>
          <p className="text-sm text-indigo-700">{t("minutes.writingHint")}</p>
        </div>
      </section>
    );
  }

  if (!minutes) {
    return (
      <section className={`${card} space-y-4`}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <FileText className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">{t("minutes.title")}</h2>
            <p className="text-sm text-slate-600">{t("minutes.intro")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Sparkles className="h-4 w-4" /> {t("minutes.generateWith", { provider: name })}
        </button>
        <p className="text-xs leading-relaxed text-slate-500">{provider === "local" ? t("llmProviders.local.privacy") : t("minutes.destination", { provider: name, where: t(`llmProviders.${provider}.where`) })}</p>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {dialog}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" onClick={share} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 sm:py-2.5">
          <Share2 className="h-4 w-4" /> {t("minutes.share")}
        </button>
        <button type="button" onClick={copy} className={secondary}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? t("exportBar.copied") : t("exportBar.copyAi")}
        </button>
        <Menu
          label={t("meeting.more")}
          buttonClassName={`w-full ${secondary}`}
          items={[
            { label: t("minutes.edit"), icon: Pencil, onClick: () => setEditing(minutes.body) },
            { label: t("minutes.downloadMd"), icon: Download, onClick: () => downloadText(minutes.body, `${base}.md`, "text/markdown") },
            { label: t("minutes.downloadTxt"), icon: FileText, onClick: () => downloadText(markdownToText(minutes.body), `${base}.txt`) },
            { label: t("minutes.regenerate"), icon: RotateCcw, onClick: generate },
            "divider",
            { label: t("minutes.delete"), icon: Trash2, onClick: remove, danger: true },
          ]}
        >
          {t("minutes.more")}
        </Menu>
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      <article className={card}>
        {editing !== null ? (
          <div className="space-y-3">
            <textarea
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              rows={Math.min(30, Math.max(12, editing.split("\n").length + 2))}
              className="w-full rounded-xl border border-slate-300 bg-surface p-3 font-mono text-sm leading-relaxed text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label={t("minutes.title")}
            />
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy || !editing.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.saveKey")}
              </button>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="minutes">{renderMarkdown(minutes.body)}</div>
        )}
      </article>
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t(minutes.edited ? "minutes.footnoteEdited" : "minutes.footnote", {
          provider: t(`llmProviders.${minutes.provider}.name`),
          model: minutes.model,
          date: new Date(minutes.updatedAt).toLocaleDateString(locale, { day: "numeric", month: "short" }),
        })}
      </p>
      {dialog}
    </section>
  );
}
