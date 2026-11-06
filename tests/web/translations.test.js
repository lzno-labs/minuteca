import { describe, expect, it } from "vitest";
import { t, translations, LANGUAGES } from "../../src/web/i18n";

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "string" ? [[prefix + k, v]] : flatten(v, `${prefix}${k}.`)));
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  const es = Object.fromEntries(flatten(translations.es));

  for (const [lang, table] of Object.entries(translations)) {
    it(`${lang} has exactly the same keys and placeholders as es`, () => {
      const other = Object.fromEntries(flatten(table));
      expect(Object.keys(other).sort()).toEqual(Object.keys(es).sort());
      for (const [key, value] of Object.entries(other)) {
        expect(value.trim(), `${lang}.${key} is empty`).not.toBe("");
        expect(placeholders(value), `${lang}.${key} placeholders`).toEqual(placeholders(es[key]));
      }
    });
  }

  it("has no long dashes in any language", () => {
    for (const [lang, table] of Object.entries(translations)) {
      for (const [key, value] of flatten(table)) expect(value, `${lang}.${key}`).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("lists Spanish first and names each language in itself", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["es", "en"]);
    expect(LANGUAGES[0]).toMatchObject({ label: "Español", locale: "es-CR" });
  });

  it("interpolates, pluralizes and falls back to Spanish", () => {
    expect(t("recorder.autosaved", { size: "1 MB" }, "es")).toBe("Guardado local automático cada 5 s · 1 MB");
    expect(t("recovery.found", { count: 1 }, "es")).toBe("Se encontró una grabación sin terminar");
    expect(t("recovery.found", { count: 3 }, "en")).toBe("3 unfinished recordings were found");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});
