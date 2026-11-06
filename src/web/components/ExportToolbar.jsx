import { useState } from "react";
import { Braces, Captions, Check, Copy, Download, FileAudio, FileText, Share2 } from "lucide-react";
import { audioExtension, fileBaseName, toAiText, toJson, toSrt, toTxt } from "../lib/format";
import { copyToClipboard, downloadBlob, downloadText } from "../lib/browser";
import { useI18n } from "../i18n";
import Dialog from "./Dialog";
import Menu from "./Menu";

/**
 * Share with an AI app (the main action), copy, and every export in one menu. Sharing always says
 * first that the transcript leaves minuteca. On phones it opens the system share sheet with the
 * text and a .txt file; elsewhere it copies the text with a request for the minutes.
 */
export default function ExportToolbar({ meeting, onDownloadAudio }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState(null); // { text, error }
  const base = fileBaseName(meeting.title);

  const flash = (text, error = false) => {
    setNotice({ text, error });
    setTimeout(() => setNotice(null), error ? 6000 : 4000);
  };

  const downloadAudio = async () => {
    try {
      const blob = await onDownloadAudio();
      downloadBlob(blob, `${base}.${audioExtension(meeting.audioType || blob.type)}`);
    } catch (err) {
      flash(t("exportBar.audioFailed", { message: err?.message || err }), true);
    }
  };

  const copy = async () => {
    if (await copyToClipboard(toAiText(meeting))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else flash(t("exportBar.clipboardFailed"), true);
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
    else flash(t("exportBar.clipboardFailed"), true);
  };

  const secondary =
    "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-surface px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={() => setSharing(true)}
          className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:py-2.5"
        >
          <Share2 className="h-4 w-4" /> {t("share.button")}
        </button>
        <button type="button" onClick={copy} className={secondary}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copied ? t("exportBar.copied") : t("exportBar.copyAi")}
        </button>
        <Menu
          label={t("exportBar.export")}
          align="right"
          buttonClassName={`w-full ${secondary}`}
          items={[
            { label: t("exportBar.txt"), icon: FileText, onClick: () => downloadText(toTxt(meeting), `${base}.txt`) },
            { label: t("exportBar.srt"), icon: Captions, onClick: () => downloadText(toSrt(meeting), `${base}.srt`, "application/x-subrip", { bom: false }) },
            { label: t("exportBar.json"), icon: Braces, onClick: () => downloadText(toJson(meeting), `${base}.json`, "application/json", { bom: false }) },
            { label: t("exportBar.audioFile"), icon: FileAudio, onClick: downloadAudio, hidden: !meeting.hasAudio },
          ]}
        >
          <Download className="h-4 w-4" /> {t("exportBar.export")}
        </Menu>
      </div>
      {notice && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ${notice.error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
          {notice.text}
        </p>
      )}
      <Dialog
        open={sharing}
        onClose={() => setSharing(false)}
        title={t("share.title")}
        actions={
          <>
            <button type="button" onClick={() => setSharing(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              {t("common.cancel")}
            </button>
            <button type="button" autoFocus onClick={share} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
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
