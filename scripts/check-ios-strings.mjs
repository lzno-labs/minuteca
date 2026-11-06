// Fails when the iOS app uses a localization key that is missing in one of its languages.
import { readFileSync, readdirSync } from "node:fs";

const root = "ios/Minuteca";
const langs = readdirSync(`${root}/Resources`).filter((d) => d.endsWith(".lproj"));
const keysOf = (lang) =>
  new Set([...readFileSync(`${root}/Resources/${lang}/Localizable.strings`, "utf8").matchAll(/^"([^"]+)"\s*=/gm)].map((m) => m[1].replace(/%lld/g, "%@")));
const tables = Object.fromEntries(langs.map((l) => [l, keysOf(l)]));
const errors = [];
const SYMBOL_ROOTS = new Set(["mic", "envelope", "lock", "icloud", "gearshape", "play", "pause", "stop", "checkmark", "exclamationmark", "safari"]);

for (const f of readdirSync(root, { recursive: true }).filter((p) => String(p).endsWith(".swift"))) {
  const src = readFileSync(`${root}/${f}`, "utf8");
  // Literal keys look like "area.name", optionally with interpolations: "area.name \(x)".
  for (const m of src.matchAll(/(systemImage: |systemName: |forKey: |forInfoDictionaryKey: |label: |rawValue|"app\.lzno)?"([a-z]+\.[a-zA-Z.]+)((?: \\\([^"]*?\))*)"/g)) {
    if (m[1]) continue;
    const name = m[2];
    if (SYMBOL_ROOTS.has(name.split(".")[0]) || /^(minuteca|app\.lzno)\./.test(name)) continue;
    const count = (m[3].match(/\\\(/g) ?? []).length;
    const key = name + " %@".repeat(count);
    for (const lang of langs) if (!tables[lang].has(key)) errors.push(`${root}/${f}: "${key}" missing in ${lang}`);
  }
}
const [first, ...rest] = langs;
for (const lang of rest) {
  for (const k of tables[first]) if (!tables[lang].has(k)) errors.push(`${lang}: missing "${k}" (present in ${first})`);
  for (const k of tables[lang]) if (!tables[first].has(k)) errors.push(`${first}: missing "${k}" (present in ${lang})`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ios strings: ok (${tables[first].size} keys, ${langs.length} languages)`);
