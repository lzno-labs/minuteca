/**
 * UI texts live in locales/<code>.json at the repository root (one file per language, the same
 * keys in each; tests/web/translations.test.js checks it). Spanish is the default language.
 * Adding a language is adding a file and a line in LANGUAGES, never a code change elsewhere.
 */
import { useSyncExternalStore } from "react";
import es from "../../../locales/es.json";
import en from "../../../locales/en.json";

export const translations = { es, en };

/** Each locale file names itself in "meta": { label, short, locale }. Spanish first. */
export const LANGUAGES = Object.entries(translations).map(([code, table]) => ({ code, ...table.meta }));

const STORAGE_KEY = "minuteca.uiLanguage";
export const FALLBACK = "es";

function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && translations[saved]) return saved;
  } catch {
    // Storage unavailable (private mode, tests).
  }
  const preferred = typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : [];
  for (const tag of preferred) {
    const code = String(tag || "").slice(0, 2).toLowerCase();
    if (translations[code]) return code;
  }
  return FALLBACK;
}

let current = detectLanguage();
const listeners = new Set();

function applyToDocument() {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
applyToDocument();

export function getLanguage() {
  return current;
}

/** BCP 47 locale for dates and numbers in the current language. */
export function getLocale(code = current) {
  return LANGUAGES.find((l) => l.code === code)?.locale || "es-CR";
}

export function setLanguage(code) {
  if (!translations[code] || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Not persisted; still switches for this session.
  }
  applyToDocument();
  listeners.forEach((fn) => fn());
}

function lookup(lang, key) {
  return key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), translations[lang]);
}

/**
 * Translates a dotted key, e.g. t("recorder.autosaved", { size: "1 MB" }).
 * Falls back to Spanish, then to the key itself, so a missing string is
 * visible but never crashes the UI. Works outside React (lib code, errors).
 * Keys ending in _one / _other are picked automatically from vars.count.
 */
export function t(key, vars = {}, lang = current) {
  let template;
  if (typeof vars.count === "number") {
    const plural = vars.count === 1 ? "one" : "other";
    template = lookup(lang, `${key}_${plural}`) ?? lookup(FALLBACK, `${key}_${plural}`);
  }
  template ??= lookup(lang, key) ?? lookup(FALLBACK, key);
  if (typeof template !== "string") return key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders the component when the language changes. */
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { t, lang, locale: getLocale(lang), setLanguage };
}
