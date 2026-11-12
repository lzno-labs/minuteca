// Server-side texts (sign-in email). They live in locales/<lang>.json with the app's texts.
import es from "../../locales/es.json" with { type: "json" };
import en from "../../locales/en.json" with { type: "json" };

type Table = Record<string, unknown>;
const TABLES: Record<string, Table> = { es, en };
export const DEFAULT_LANG = "es";

/** Whether texts (and prompts) exist in this language: "es", "en". */
export const hasLanguage = (code: string): boolean => Boolean(TABLES[code]);

/** Picks a supported language from an Accept-Language header; Spanish by default. */
export function pickLanguage(header: string | null | undefined): string {
  for (const part of (header ?? "").split(",")) {
    const code = part.split(";")[0]!.trim().slice(0, 2).toLowerCase();
    if (TABLES[code]) return code;
  }
  return DEFAULT_LANG;
}

function lookup(table: Table | undefined, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Table)[part] : undefined), table);
}

export function t(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const template = lookup(TABLES[lang], key) ?? lookup(TABLES[DEFAULT_LANG], key);
  if (typeof template !== "string") return key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] !== undefined ? String(vars[name]) : m));
}
