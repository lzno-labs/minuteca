import { useEffect, useRef, useState } from "react";
import { FileUp, AlertTriangle } from "lucide-react";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES, audioMimeType } from "../lib/audioFile";
import { useI18n } from "../i18n";

/**
 * Upload a recording made with another app (phone voice memo, Zoom, etc.).
 * Accepts a file picker or drag & drop; calls onFile(file, mimeType).
 */
export default function ImportAudio({ onFile, disabled, maxBytes = MAX_FILE_BYTES }) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);

  // A file dropped outside the drop zone would make the browser navigate
  // away from the app (and lose an in-progress recording's UI state).
  useEffect(() => {
    const block = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const pick = (files) => {
    setError(null);
    const file = files?.[0];
    if (!file) return;
    const type = audioMimeType(file);
    if (!type) {
      setError(t("importAudio.notAudio", { name: file.name }));
      return;
    }
    if (file.size === 0) {
      setError(t("importAudio.empty", { name: file.name }));
      return;
    }
    if (file.size > maxBytes) {
      setError(t("importAudio.tooLarge", { name: file.name, size: Math.floor(maxBytes / 1024 / 1024) }));
      return;
    }
    if (files.length > 1) setError(t("importAudio.onlyFirst"));
    onFile(file, type);
  };

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
      className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${
        dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-surface"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <FileUp className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{t("importAudio.title")}</p>
            <p className="text-sm text-slate-500">
              {t("importAudio.hint", { size: Math.floor(maxBytes / 1024 / 1024) })}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="shrink-0 rounded-lg border border-slate-300 bg-surface px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed"
        >
          {t("importAudio.button")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = ""; // allow picking the same file again
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 flex items-center justify-center gap-1.5 text-sm text-rose-700 sm:justify-start">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}
    </section>
  );
}
