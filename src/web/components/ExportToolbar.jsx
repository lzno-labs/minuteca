import { useState } from "react";
import { Braces, Captions, Check, Copy, Download, FileText, Loader2, Share2, Trash2 } from "lucide-react";
import { fileBaseName, toAiText, toJson, toSrt, toTxt } from "../lib/format";
import { audioExtension } from "../lib/format";
import { copyToClipboard, downloadBlob, downloadText } from "../lib/browser";
import { useI18n } from "../i18n";
import Dialog from "./Dialog";

/**
 * Exports (TXT, SRT, JSON, audio) and "share with an AI app". Sharing always says first that the
 * transcript leaves minuteca. On phones it opens the system share sheet with the text and a .txt
 * file; elsewhere it copies the text with a request for the minutes.
 */
export default function ExportToolbar({ meeting, onDownloadAudio, onRemoveAudio }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState(null);
  const base = fileBaseName(meeting.title);
  const hasText = meeting.utterances?.length > 0;

  const downloadAudio = async () => {
    setDownloading(true);
    try {
      const blob = await onDownloadAudio();
      downloadBlob(blob, `${base}.${audioExtension(meeting.audioType || blob.type)}`);
    } catch (err) {
      alert(t("exportBar.audioFailed", { message: err?.message || err }));
    } finally {
      setDownloading(false);
    }
  };

  const flash = (text) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 4000);
  };

  const copy = async () => {
    if (await copyToClipboard(toAiText(meeting))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else alert(t("exportBar.clipboardFailed"));
  };

  const share = async () => {
    setSharing(false);
    const text = `${t("share.prompt")}\n\n${toAiText(meeting)}`;
    const file = new File(["﻿", toTxt(meeting)], `${base}.txt`, { type: "text/plain" });
    const data = { title: meeting.title, text, files: [file] };
    if (navigator.canShare?.(data)) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    if (await copyToClipboard(text)) flash(t("share.copied"));
    else alert(t("exportBar.clipboardFailed"));
  };

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {hasText && (
          <>
            <button
              type="button"
              onClick={() => setSharing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <Share2 className="h-4 w-4" /> {t("share.button")}
            </button>
            <button type="button" onClick={copy} className={btn}>
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? t("exportBar.copied") : t("exportBar.copyAi")}
            </button>
            <button type="button" className={btn} onClick={() => downloadText(toTxt(meeting), `${base}.txt`)}>
              <FileText className="h-4 w-4" /> .txt
            </button>
            <button type="button" className={btn} onClick={() => downloadText(toSrt(meeting), `${base}.srt`, "application/x-subrip", { bom: false })}>
              <Captions className="h-4 w-4" /> .srt
            </button>
            <button type="button" className={btn} onClick={() => downloadText(toJson(meeting), `${base}.json`, "application/json", { bom: false })}>
              <Braces className="h-4 w-4" /> .json
            </button>
          </>
        )}
        {meeting.hasAudio && (
          <>
            <button type="button" className={btn} onClick={downloadAudio} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t("common.audio")}
            </button>
            {meeting.status === "done" && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => confirm(t("exportBar.removeAudioConfirm")) && onRemoveAudio()}
              >
                <Trash2 className="h-4 w-4" /> {t("exportBar.removeAudio")}
              </button>
            )}
          </>
        )}
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <Dialog
        open={sharing}
        onClose={() => setSharing(false)}
        title={t("share.title")}
        actions={
          <>
            <button type="button" onClick={() => setSharing(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={share} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              {t("share.continue")}
            </button>
          </>
        }
      >
        <p>{t("share.warning")}</p>
        <p className="text-xs text-slate-500">{t("share.how")}</p>
      </Dialog>
    </div>
  );
}
