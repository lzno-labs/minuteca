// Pure helpers that turn speaker segments and recognized text into minuteca blocks
// (docs/design/desktop-app.md). No native code here, so they run in tests and in any process.
import { round, speakerIndexer } from "../../src/server/transcriber/transcriber.ts";
import type { Block, Sentence } from "../../src/server/transcriber/transcriber.ts";

export const SAMPLE_RATE = 16_000;

/** A stretch of speech by one voice, in seconds (speaker separation output, or a window for recognition). */
export interface Segment {
  start: number;
  end: number;
  speaker: number;
}

/** What speech recognition returns for one window: token times are relative to the window start. */
export interface Recognized {
  text: string;
  tokens: string[];
  timestamps: number[];
  durations?: number[];
}

export interface Piece extends Segment {
  text: string;
  sentences: Sentence[];
}

/** Joins consecutive segments of the same voice into windows for speech recognition. */
export function windowsFrom(segments: Segment[], { maxGap = 1, maxSeconds = 30 } = {}): Segment[] {
  const out: Segment[] = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    if (!(s.end > s.start)) continue;
    const last = out.at(-1);
    if (last && last.speaker === s.speaker && s.start - last.end <= maxGap && s.end - last.start <= maxSeconds) {
      last.end = Math.max(last.end, s.end);
    } else {
      out.push({ start: s.start, end: s.end, speaker: s.speaker });
    }
  }
  return out;
}

/** Time (seconds) of the quietest 100 ms between from and to, where a cut is least likely to split a word. */
export function quietestPoint(samples: Float32Array, from: number, to: number): number {
  const frame = SAMPLE_RATE / 10;
  let best = to;
  let bestEnergy = Infinity;
  for (let i = Math.floor(from * SAMPLE_RATE); i + frame <= Math.min(to * SAMPLE_RATE, samples.length); i += frame) {
    let e = 0;
    for (let j = i; j < i + frame; j++) e += samples[j]! * samples[j]!;
    if (e < bestEnergy) {
      bestEnergy = e;
      best = (i + frame / 2) / SAMPLE_RATE;
    }
  }
  return best;
}

/** Cuts windows longer than maxSeconds at quiet moments, so recognition never gets one huge input. */
export function splitLong(windows: Segment[], samples: Float32Array, maxSeconds = 30): Segment[] {
  const out: Segment[] = [];
  for (const w of windows) {
    let start = w.start;
    while (w.end - start > maxSeconds) {
      const cut = quietestPoint(samples, start + maxSeconds * 0.66, start + maxSeconds);
      out.push({ start, end: cut, speaker: w.speaker });
      start = cut;
    }
    out.push({ start, end: w.end, speaker: w.speaker });
  }
  return out;
}

/** Sentences with times from the recognizer's tokens; a sentence ends at . ? ! or … */
export function sentencesFrom(r: Recognized, offset: number): Sentence[] {
  const out: Sentence[] = [];
  let cur: Sentence | null = null;
  const close = () => {
    if (cur && cur.text.trim()) out.push({ start: round(cur.start), end: round(cur.end), text: cur.text.trim() });
    cur = null;
  };
  r.tokens.forEach((token, i) => {
    const start = offset + (r.timestamps[i] ?? 0);
    const end = start + (r.durations?.[i] ?? 0);
    cur ??= { start, end, text: "" };
    cur.text += token;
    cur.end = Math.max(cur.end, end);
    if (/[.?!…]$/.test(token.trim())) close();
  });
  close();
  return out;
}

/** Blocks in minuteca's format: same voice in a row becomes one block, voices numbered by first appearance. */
export function toBlocks(pieces: Piece[], maxGap = 2): Block[] {
  const index = speakerIndexer();
  const out: Block[] = [];
  for (const p of pieces) {
    const text = p.text.trim();
    if (!text) continue;
    const speaker = index(p.speaker);
    const last = out.at(-1);
    if (last && last.speaker === speaker && p.start - last.end <= maxGap) {
      last.end = round(p.end);
      last.text += ` ${text}`;
      last.sentences!.push(...p.sentences);
    } else {
      out.push({ speaker, start: round(p.start), end: round(p.end), text, sentences: [...p.sentences] });
    }
  }
  return out;
}

/** 16-bit little-endian PCM to floats in [-1, 1). */
export function s16leToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Samples of a 16-bit PCM mono WAV file (what afconvert writes). */
export function parseWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let sampleRate = 0;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      const format = view.getUint16(at + 8, true);
      const channels = view.getUint16(at + 10, true);
      const bits = view.getUint16(at + 22, true);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error("expected 16-bit PCM mono WAV");
      sampleRate = view.getUint32(at + 12, true);
    } else if (id === "data") {
      if (!sampleRate) throw new Error("WAV data before format");
      return { sampleRate, samples: s16leToFloat(bytes.subarray(at + 8, Math.min(at + 8 + size, bytes.byteLength))) };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV without data");
}
