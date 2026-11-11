import { useMemo, useState } from "react";
import { Check, Copy, Download, FileText, Loader2, Pencil, Plus, Settings, Share2, Sparkles, Trash2, Undo2, WandSparkles } from "lucide-react";
import { api } from "../lib/api";
import { llmMissing, startingLlm } from "../lib/llm";
import { minutesSections, replaceSection } from "../lib/sections";
import LlmChoice from "./LlmChoice";
import { markdownToText, renderMarkdown } from "../lib/markdown";
import { fileBaseName } from "../lib/format";
import { copyToClipboard, downloadText } from "../lib/browser";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";
import { useLlmConsent } from "./LlmConsent";
import Menu from "./Menu";

const field =
  "w-full rounded-xl border border-slate-300 bg-surface p-3 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

/**
 * The minutes of a meeting, written by a language model the person configured (with their own key),
 * then theirs to edit, copy, share or download. Always labelled as AI-generated. Each generation is
 * a new version, so different models can be compared (docs/design/minutes-with-llm.md). Each part
 * can be edited by hand or changed on request to the model, and every change can be undone
 * (docs/design/automatic-minutes-and-revisions.md).
 */
export default function MinutesPanel({ meeting, me, onMeChange, onChanged, onOpenSettings, autoWriting = null }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const { ensure, dialog } = useLlmConsent(me, onMeChange);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revising, setRevising] = useState(null); // index of the part being changed, or "all"
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // draft of the whole text
  const [partEdit, setPartEdit] = useState(null); // { index, text }
  const [ask, setAsk] = useState(null); // { index, text }: a request for one part
  const [askAll, setAskAll] = useState("");
  const [copied, setCopied] = useState(false);
  const versions = meeting.minutesVersions ?? (meeting.minutes ? [meeting.minutes] : []);
  const [selected, setSelected] = useState(null);
  const minutes = versions.find((v) => v.id === selected) ?? versions[0] ?? null;
  const sections = useMemo(() => minutesSections(minutes?.body ?? ""), [minutes?.body]);
  const [provider, setProvider] = useState(() => startingLlm(me));
  const missing = llmMissing(me, provider);
  const name = provider ? t(`llmProviders.${provider}.name`) : "";
  const base = `${fileBaseName(meeting.title)}_minuta`;
  const day = (iso) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const working = saving || revising !== null;

  const closeForms = () => {
    setEditing(null);
    setPartEdit(null);
    setAsk(null);
  };

  // Nothing is replaced: each generation is a new version, shown first.
  const generate = async () => {
    if (!(await ensure(provider))) return;
    setGenerating(true);
    setError(null);
    try {
      const made = await api(`/meetings/${meeting.id}/minutes`, { method: "POST", body: { provider } });
      setSelected(made.id);
      closeForms();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const saveBody = async (body) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/meetings/${meeting.id}/minutes`, { method: "PUT", body: { body, id: minutes.id } });
      closeForms();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // The model rereads the transcript and changes all of it, or one part, as the person asks.
  const revise = async (target, instruction) => {
    if (!instruction.trim() || !(await ensure(provider))) return;
    setRevising(target);
    setError(null);
    try {
      const part = target === "all" ? {} : { part: sections[target].text };
      await api(`/meetings/${meeting.id}/minutes/${minutes.id}/revise`, { method: "POST", body: { instruction: instruction.trim(), provider, ...part } });
      if (target === "all") setAskAll("");
      setAsk(null);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setRevising(null);
    }
  };

  const undo = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/meetings/${meeting.id}/minutes/${minutes.id}/undo`, { method: "POST" });
      closeForms();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const several = versions.length > 1;
    const ok = await confirm({
      title: t(several ? "minutes.deleteVersionTitle" : "minutes.deleteTitle"),
      body: t(several ? "minutes.deleteVersionBody" : "minutes.deleteBody"),
      confirmLabel: t("meeting.deleteShort"),
      danger: true,
    });
    if (ok) {
      await api(`/meetings/${meeting.id}/minutes/${minutes.id}`, { method: "DELETE" });
      setSelected(null);
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
  const primarySmall = "inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";
  const plainSmall = "rounded-lg px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-100";
  const iconButton = "rounded-md p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40";

  if (generating || autoWriting) {
    const writer = autoWriting ? t(`llmProviders.${autoWriting}.name`) : name;
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-900" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
        <div>
          <p className="font-semibold">{t("minutes.writing", { provider: writer })}</p>
          <p className="text-sm text-indigo-700">{t("minutes.writingHint")}</p>
        </div>
      </section>
    );
  }

  // Without a ready model, existing minutes still show; only a first one needs Settings.
  if (missing && !minutes) {
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
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={generate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
          >
            <Sparkles className="h-4 w-4" /> {t("minutes.generateWith", { provider: name })}
          </button>
          <LlmChoice me={me} value={provider} onChange={setProvider} />
        </div>
        <p className="text-xs leading-relaxed text-slate-500">{provider === "local" ? t("llmProviders.local.privacy") : t("minutes.destination", { provider: name, where: t(`llmProviders.${provider}.where`) })}</p>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {dialog}
      </section>
    );
  }

  const footnote = minutes.revisedWith ? "minutes.footnoteRevised" : minutes.edited ? "minutes.footnoteEdited" : "minutes.footnote";

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
            {
              label: t("minutes.edit"),
              icon: Pencil,
              onClick: () => {
                closeForms();
                setEditing(minutes.body);
              },
            },
            { label: t("minutes.downloadMd"), icon: Download, onClick: () => downloadText(minutes.body, `${base}.md`, "text/markdown") },
            { label: t("minutes.downloadTxt"), icon: FileText, onClick: () => downloadText(markdownToText(minutes.body), `${base}.txt`) },
            "divider",
            { label: t(versions.length > 1 ? "minutes.deleteVersion" : "minutes.delete"), icon: Trash2, onClick: remove, danger: true },
          ]}
        >
          {t("minutes.more")}
        </Menu>
      </div>
      {versions.length > 1 && (
        <div role="tablist" aria-label={t("minutes.versions")} className="flex gap-2 overflow-x-auto pb-1">
          {versions.map((v) => {
            const active = v.id === minutes.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  closeForms();
                  setSelected(v.id);
                }}
                className={`shrink-0 rounded-xl border px-3 py-1.5 text-left text-xs ${active ? "border-indigo-300 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200" : "border-slate-200 bg-surface text-slate-600 hover:bg-slate-50"}`}
              >
                <span className="block font-semibold">{t(`llmProviders.${v.provider}.name`)}</span>
                <span className="block max-w-40 truncate font-mono text-[11px] text-slate-500">{v.model}</span>
                <span className="block text-slate-500">{day(v.createdAt)}</span>
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      <article className={card}>
        {editing !== null ? (
          <div className="space-y-3">
            <textarea
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              rows={Math.min(30, Math.max(12, editing.split("\n").length + 2))}
              className={`${field} font-mono`}
              aria-label={t("minutes.title")}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => saveBody(editing)} disabled={saving || !editing.trim()} className={primarySmall}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.saveKey")}
              </button>
              <button type="button" onClick={() => setEditing(null)} className={plainSmall}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="minutes -mx-2">
            {sections.map((s, i) => (
              <div key={`${minutes.id}-${i}`} className={`group relative rounded-xl px-2 pb-0.5 ${ask?.index === i || partEdit?.index === i ? "bg-indigo-50/50 ring-1 ring-indigo-100" : "hover:bg-slate-50"}`}>
                {partEdit?.index === i ? (
                  <div className="space-y-2 py-2">
                    <textarea
                      value={partEdit.text}
                      onChange={(e) => setPartEdit({ index: i, text: e.target.value })}
                      rows={Math.min(20, Math.max(4, partEdit.text.split("\n").length + 1))}
                      className={`${field} font-mono`}
                      aria-label={t("minutes.editPart")}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => saveBody(replaceSection(minutes.body, s, partEdit.text))} disabled={saving} className={primarySmall}>
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.saveKey")}
                      </button>
                      <button type="button" onClick={() => setPartEdit(null)} className={plainSmall}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="absolute right-1 top-1 z-[1] flex gap-0.5 rounded-lg bg-surface/90 p-0.5 shadow-sm ring-1 ring-slate-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          closeForms();
                          setPartEdit({ index: i, text: s.text.replace(/\s+$/, "") });
                        }}
                        aria-label={t("minutes.editPart")}
                        title={t("minutes.editPart")}
                        className={iconButton}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={working || missing}
                        onClick={() => {
                          closeForms();
                          setAsk({ index: i, text: "" });
                        }}
                        aria-label={t("minutes.askPart")}
                        title={t("minutes.askPart")}
                        className={iconButton}
                      >
                        <WandSparkles className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className={`pr-16 ${revising === i ? "opacity-50" : ""}`}>{renderMarkdown(s.text)}</div>
                  </>
                )}
                {revising === i && (
                  <p className="flex items-center gap-2 pb-2 text-sm text-indigo-800" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t("minutes.revising", { provider: name })}
                  </p>
                )}
                {ask?.index === i && revising !== i && (
                  <form
                    className="space-y-2 pb-3 pt-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      revise(i, ask.text);
                    }}
                  >
                    <textarea
                      value={ask.text}
                      onChange={(e) => setAsk({ index: i, text: e.target.value })}
                      rows={2}
                      maxLength={2000}
                      placeholder={t("minutes.askPlaceholder")}
                      className={field}
                      aria-label={t("minutes.askPart")}
                      autoFocus
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="submit" disabled={!ask.text.trim() || working} className={primarySmall}>
                        <WandSparkles className="h-4 w-4" /> {t("minutes.apply", { provider: name })}
                      </button>
                      <LlmChoice me={me} value={provider} onChange={setProvider} disabled={working} />
                      <button type="button" onClick={() => setAsk(null)} className={plainSmall}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </article>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex min-w-0 basis-full items-start gap-1.5 text-xs text-slate-500 sm:basis-0 sm:flex-1">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t(footnote, {
            provider: t(`llmProviders.${minutes.provider}.name`),
            model: minutes.model,
            reviser: minutes.revisedWith ? t(`llmProviders.${minutes.revisedWith}.name`) : "",
            date: new Date(minutes.updatedAt).toLocaleDateString(locale, { day: "numeric", month: "short" }),
          })}
        </p>
        {minutes.canUndo && editing === null && (
          <button type="button" onClick={undo} disabled={working} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            <Undo2 className="h-4 w-4" /> {t("minutes.undo")}
          </button>
        )}
      </div>

      {!missing && editing === null && (
        <form
          className="space-y-2 rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            revise("all", askAll);
          }}
        >
          <label htmlFor={`ask-all-${minutes.id}`} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <WandSparkles className="h-4 w-4 text-indigo-600" /> {t("minutes.askAllTitle")}
          </label>
          <p className="text-xs text-slate-500">{t("minutes.askAllHint")}</p>
          <textarea
            id={`ask-all-${minutes.id}`}
            value={askAll}
            onChange={(e) => setAskAll(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={t("minutes.askAllPlaceholder")}
            className={field}
            disabled={revising === "all"}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!askAll.trim() || working} className={primarySmall}>
              {revising === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
              {revising === "all" ? t("minutes.revising", { provider: name }) : t("minutes.apply", { provider: name })}
            </button>
            <LlmChoice me={me} value={provider} onChange={setProvider} disabled={working} />
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-3">
        <button type="button" onClick={missing ? onOpenSettings : generate} disabled={working} className={secondary}>
          <Plus className="h-4 w-4" /> {t("minutes.another")}
        </button>
        <LlmChoice me={me} value={provider} onChange={setProvider} />
        <p className="basis-full text-xs text-slate-500">{t("minutes.anotherHint")}</p>
      </div>
      {dialog}
    </section>
  );
}
