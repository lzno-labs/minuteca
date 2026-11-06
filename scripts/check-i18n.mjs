// Fails when visible text is written in the code instead of locales/, when a key used by the
// web app is missing, or when a server error code has no text. Run by `npm run lint`.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const es = JSON.parse(readFileSync("locales/es.json", "utf8"));
const has = (key) => key.split(".").reduce((n, p) => (n == null ? undefined : n[p]), es) !== undefined;
const errors = [];

const files = (dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f)));
const web = files("src/web").filter((f) => /\.(jsx?|tsx?)$/.test(f));

for (const f of web) {
  const src = readFileSync(f, "utf8");
  // Keys used as literals: t("area.key").
  for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
    const key = m[1];
    if (!has(key) && !has(`${key}_one`)) errors.push(`${f}: missing key "${key}"`);
  }
  // Keys chosen with a ternary: t(cond ? "a.b" : "c.d").
  for (const m of src.matchAll(/\bt\([^()"]*\?\s*"([a-z][\w.]+)"\s*:\s*"([a-z][\w.]+)"/g)) {
    for (const key of [m[1], m[2]]) if (!has(key)) errors.push(`${f}: missing key "${key}"`);
  }
  if (!f.endsWith(".jsx")) continue;
  // Text between JSX tags: >Some words< (product name and symbols allowed).
  for (const m of src.matchAll(/>\s*([^<>{}\n]*[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}[^<>{}\n]*)\s*</g)) {
    const text = m[1].trim();
    if (!text || /^(minuteca|\.txt|\.srt|\.json|=>.*|&&.*)$/.test(text) || /[=;(]/.test(text)) continue;
    errors.push(`${f}: hardcoded text "${text}"`);
  }
  // Literal accessible names and placeholders.
  for (const m of src.matchAll(/\b(aria-label|title|placeholder|alt)="([^"]*[A-Za-z][^"]*)"/g)) {
    errors.push(`${f}: hardcoded ${m[1]}="${m[2]}"`);
  }
}

// Every error code the server can answer has a text.
for (const f of files("src/server").filter((x) => x.endsWith(".ts"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/err\(c, \d+, "([a-z_]+)"\)|TranscriptionError\("([a-z_]+)"|ProviderError\("([a-z_]+)"/g)) {
    const code = m[1] || m[2] || m[3];
    if (!has(`errors.${code}`)) errors.push(`${f}: no text for error code "${code}" (locales errors.${code})`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`i18n: ok (${web.length} web files)`);
