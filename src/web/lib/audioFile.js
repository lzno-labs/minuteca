/** Helpers for audio files recorded with other apps (unit-tested). */
import { t } from "../i18n";

const TYPES_BY_EXTENSION = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  m4v: "video/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  wave: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  weba: "audio/webm",
  flac: "audio/flac",
  amr: "audio/amr",
  "3gp": "audio/3gpp",
  "3ga": "audio/3gpp",
  wma: "audio/x-ms-wma",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  caf: "audio/x-caf",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

export const ACCEPT_ATTRIBUTE = ["audio/*", "video/*", ...Object.keys(TYPES_BY_EXTENSION).map((e) => `.${e}`)].join(",");

/** Deepgram's documented upper bound for pre-recorded audio. */
/** Default upload limit; the server tells the real one (GET /api/me, maxAudioBytes). */
export const MAX_FILE_BYTES = 95 * 1024 * 1024;

export function fileExtension(name = "") {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * The MIME type to send. Browsers often report "" (e.g. .amr, .opus on
 * Windows) or odd aliases, so the extension wins when we know it.
 * Returns null for files that are clearly not audio/video.
 */
export function audioMimeType(file) {
  const byExt = TYPES_BY_EXTENSION[fileExtension(file.name)];
  if (byExt) return byExt;
  if (/^(audio|video)\//.test(file.type || "")) return file.type;
  return null;
}

/** "Reunión directorio.m4a" → "Reunión directorio" */
export function titleFromFileName(name = "") {
  const base = name.replace(/\.[^./\\]+$/, "").replace(/[_]+/g, " ").trim();
  return base || t("importAudio.defaultTitle");
}
