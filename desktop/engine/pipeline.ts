// Local transcription: speaker separation first, then speech recognition per voice turn
// (docs/design/desktop-app.md). The engine is injected, so this file has no native code.
import { round } from "../../src/server/transcriber/transcriber.ts";
import type { Block } from "../../src/server/transcriber/transcriber.ts";
import { mostFrequent, SAMPLE_RATE, type Recognized, type Segment, sentencesFrom, splitLong, toBlocks, windowsFrom } from "./blocks.ts";
import { MODEL_NAME } from "./models.ts";

export interface Engine {
  /** What goes in the transcript's `model` field (models.ts, modelName). */
  name?: string;
  /** Speaker turns. A lower threshold splits voices more readily, a higher one merges them. */
  diarize(samples: Float32Array, threshold?: number): Segment[];
  recognize(samples: Float32Array): Recognized;
}

/** minuteca transcript format v1 (ADR-0002) with the provider that ran on this computer. */
export interface LocalTranscript {
  format: "minuteca-transcript";
  version: 1;
  provider: "local";
  model: string;
  language: string | null;
  duration: number;
  blocks: Block[];
}

export interface Steps {
  separated?(voices: number, windows: number): void;
  recognized?(done: number, total: number): void;
}

export function transcribe(engine: Engine, samples: Float32Array, threshold?: number, steps: Steps = {}): LocalTranscript {
  const segments = engine.diarize(samples, threshold);
  const windows = splitLong(windowsFrom(segments), samples);
  steps.separated?.(new Set(segments.map((s) => s.speaker)).size, windows.length);
  const langs: (string | undefined)[] = [];
  const pieces = windows.map((w, i) => {
    const r = engine.recognize(samples.subarray(Math.floor(w.start * SAMPLE_RATE), Math.ceil(w.end * SAMPLE_RATE)));
    langs.push(r.lang);
    steps.recognized?.(i + 1, windows.length);
    return { ...w, text: r.text, sentences: sentencesFrom(r, w.start, w.end - w.start) };
  });
  return {
    format: "minuteca-transcript",
    version: 1,
    provider: "local",
    model: engine.name ?? MODEL_NAME,
    // Whisper reports the language it heard; Parakeet v3 detects it on its own and does not say.
    language: mostFrequent(langs),
    duration: round(samples.length / SAMPLE_RATE),
    blocks: toBlocks(pieces),
  };
}
