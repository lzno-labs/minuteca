// Which local speech model suits this computer (ADR-0007, docs/design/local-models.md). Pure: the
// app passes the computer's memory and cores, so this runs in tests and in any process.
import { SPEECH_MODELS, type SpeechModel, type SpeechModelId } from "./models.ts";

export interface Specs {
  /** Total memory, in GB. */
  memoryGb: number;
  /** Logical cores. */
  cores: number;
}

/** Threads the engine uses: one core stays free so the computer still answers. */
export const threadsFor = (cores: number) => Math.max(1, Math.min(8, Math.floor(cores) - 1));

export type Fit = "ok" | "slow" | "too_big";

export interface Assessment {
  fit: Fit;
  /** Estimated minutes of work for one hour of audio. */
  minutesPerHour: number;
}

/** The measured speed was with 4 threads; more or fewer threads scale it, roughly. */
export function assess(model: SpeechModel, specs: Specs): Assessment {
  const minutesPerHour = Math.max(1, Math.round(model.realTime * 60 * (4 / threadsFor(specs.cores))));
  const fit: Fit = specs.memoryGb < model.minMemoryGb ? "too_big" : minutesPerHour > 60 ? "slow" : "ok";
  return { fit, minutesPerHour };
}

/** Parakeet was the most accurate and the fastest in our tests; Whisper base for small computers. */
export function recommended(specs: Specs): SpeechModelId {
  return specs.memoryGb < 6 ? "whisper-base" : "parakeet-v3";
}

/** What the app shows: every model with its fit, size and whether it is here. */
export function catalog(specs: Specs, downloaded: readonly string[]) {
  const pick = recommended(specs);
  return SPEECH_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    size: m.files.reduce((n, f) => n + f.size, 0),
    minMemoryGb: m.minMemoryGb,
    ...assess(m, specs),
    downloaded: downloaded.includes(m.id),
    recommended: m.id === pick,
  }));
}
