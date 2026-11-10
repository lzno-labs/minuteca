// Compares a local transcript with one from a cloud provider (phase 1 of docs/design/desktop-app.md).
// Neither is ground truth, so the numbers say how alike they are, not which one is right.
import { fromDeepgram } from "../../src/server/transcriber/deepgram.ts";

export interface TimedBlock {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

const HEADER = /^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s+(.+?):\s*$/;

/** Reads minuteca's TXT export (the Firebase version's too): "[mm:ss] Name:" then the text. */
export function parseTxt(txt: string): TimedBlock[] {
  const out: TimedBlock[] = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = HEADER.exec(line);
    if (m) {
      const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const prev = out.at(-1);
      if (prev) prev.end = Math.max(prev.start, start);
      out.push({ speaker: m[4]!, start, end: start, text: "" });
    } else if (out.length && line.trim()) {
      out.at(-1)!.text += `${out.at(-1)!.text ? " " : ""}${line.trim()}`;
    }
  }
  const last = out.at(-1);
  if (last) last.end = last.start + Math.max(2, words(last.text).length * 0.4);
  return out;
}

interface BlocksLike {
  blocks: { speaker: number; start: number; end: number; text: string }[];
}

/** A reference from a file's contents: minuteca TXT, a minuteca transcript or meeting JSON, or a raw Deepgram answer. */
export function readReference(name: string, contents: string): TimedBlock[] {
  if (!/\.json$/i.test(name)) return parseTxt(contents);
  const data = JSON.parse(contents);
  const t: BlocksLike | null =
    data?.format === "minuteca-transcript" ? data
    : data?.transcript?.format === "minuteca-transcript" ? data.transcript
    : data?.results?.channels ? fromDeepgram(data)
    : null;
  if (!t) throw new Error("unknown JSON: expected a minuteca transcript or a Deepgram answer");
  return t.blocks.map((b) => ({ speaker: String(b.speaker), start: b.start, end: b.end, text: b.text }));
}

/** Lowercase words without punctuation, for counting differences. */
export function words(text: string): string[] {
  return text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** Word error rate of hyp against ref: insertions, deletions and substitutions over ref length. */
export function wordErrorRate(ref: string[], hyp: string[]): number {
  if (!ref.length) return hyp.length ? 1 : 0;
  let row = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const next = [i];
    for (let j = 1; j <= hyp.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[hyp.length]! / ref.length;
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Share of overlapping speech time where both say it is the same person, after pairing each reference
 * voice with the local voice it overlaps most (greedy, one to one).
 */
export function speakerAgreement(ref: TimedBlock[], hyp: TimedBlock[]): number {
  const time = new Map<string, number>();
  let total = 0;
  for (const r of ref) {
    for (const h of hyp) {
      const o = overlap(r, h);
      if (!o) continue;
      const key = `${r.speaker}\u0000${h.speaker}`;
      time.set(key, (time.get(key) ?? 0) + o);
      total += o;
    }
  }
  if (!total) return 0;
  const pairs = [...time].sort((a, b) => b[1] - a[1]);
  const usedRef = new Set<string>();
  const usedHyp = new Set<string>();
  let matched = 0;
  for (const [key, t] of pairs) {
    const [r, h] = key.split("\u0000") as [string, string];
    if (usedRef.has(r) || usedHyp.has(h)) continue;
    usedRef.add(r);
    usedHyp.add(h);
    matched += t;
  }
  return matched / total;
}

export interface Comparison {
  wordsAlike: number;
  voicesAlike: number;
  localVoices: number;
  referenceVoices: number;
}

export function compare(ref: TimedBlock[], local: TimedBlock[]): Comparison {
  return {
    wordsAlike: Math.max(0, 1 - wordErrorRate(ref.flatMap((b) => words(b.text)), local.flatMap((b) => words(b.text)))),
    voicesAlike: speakerAgreement(ref, local),
    localVoices: new Set(local.map((b) => b.speaker)).size,
    referenceVoices: new Set(ref.map((b) => b.speaker)).size,
  };
}
