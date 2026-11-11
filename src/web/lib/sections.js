/**
 * Splits minutes (Markdown) into the parts a person edits or asks to change one at a time
 * (docs/design/automatic-minutes-and-revisions.md). A part starts at a main heading: the smallest
 * heading level used at least twice, or any level above it (the title). Text before the first
 * heading is a part too. The parts cover the whole text, in order, so joining them gives it back.
 */
const HEADING = /^(#{1,6})\s+\S/;

export function minutesSections(body) {
  const text = String(body ?? "");
  const lines = text.split("\n");
  const levels = lines.map((l) => HEADING.exec(l)?.[1].length ?? 0);
  const counts = {};
  for (const l of levels) if (l) counts[l] = (counts[l] ?? 0) + 1;
  const used = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const split = used.find((l) => counts[l] >= 2) ?? used[0] ?? 0;

  const sections = [];
  let start = 0;
  let offset = 0;
  lines.forEach((line, i) => {
    if (i > 0 && levels[i] && levels[i] <= split) {
      sections.push({ start, end: offset });
      start = offset;
    }
    offset += line.length + 1;
  });
  sections.push({ start, end: text.length });
  return sections
    .map((s) => ({ ...s, text: text.slice(s.start, s.end) }))
    .filter((s) => s.text.trim());
}

/**
 * The whole text with one part replaced by what the person wrote, keeping the blank lines that
 * separated it from the next part. An empty replacement removes the part.
 */
export function replaceSection(body, section, replacement) {
  const text = String(body ?? "");
  const trail = /\s*$/.exec(section.text)[0];
  const next = replacement.trim();
  return text.slice(0, section.start) + (next ? next + (trail || "\n") : "") + text.slice(section.end);
}
