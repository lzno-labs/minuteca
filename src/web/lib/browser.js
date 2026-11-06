/** Browser-only helpers: downloads, clipboard, settings. */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text, filename, mime = "text/plain", { bom = true } = {}) {
  // BOM so Windows Notepad picks UTF-8 for names with accents. Some subtitle
  // tools reject it, so SRT downloads skip it.
  const parts = bom ? ["\ufeff", text] : [text];
  downloadBlob(new Blob(parts, { type: `${mime};charset=utf-8` }), filename);
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

const SETTINGS_KEY = "minuteca.settings";
export const DEFAULT_SETTINGS = { keepAudio: true, language: "es" };

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode etc.; settings just won't persist.
  }
}

/** Audio languages; labels live in locales under audioLanguages.<key>. "multi" only works with Deepgram. */
export const AUDIO_LANGUAGES = [
  { value: "", key: "auto" },
  { value: "en", key: "en" },
  { value: "es", key: "es" },
  { value: "multi", key: "multi" },
  { value: "fr", key: "fr" },
  { value: "de", key: "de" },
  { value: "pt", key: "pt" },
  { value: "it", key: "it" },
];

/** Safari and every other browser on iPhone or iPad: recording stops when the screen locks. */
export function isIosBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
