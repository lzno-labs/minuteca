// Phase 1 of docs/design/desktop-app.md: transcribe an audio file on this computer with local models
// and, optionally, compare it with a cloud transcript of the same meeting. Nothing leaves the computer
// except the one-time model download.
//   npm ci --prefix desktop                                   (once)
//   npm run local:transcribe -- meeting.m4a [--compare meeting.txt] [--threshold 0.5]
import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import es from "../locales/es.json" with { type: "json" };
import { decodeAudio } from "./engine/audio.ts";
import { SAMPLE_RATE } from "./engine/blocks.ts";
import { compare, readReference } from "./engine/compare.ts";
import { CREDITS, DEFAULT_SPEECH, defaultModelsDir, ensureModels, filesFor, SPEECH_MODELS, speechModel } from "./engine/models.ts";
import { type LocalTranscript, transcribe } from "./engine/pipeline.ts";
import { DEFAULT_THRESHOLD, sherpaEngine } from "./engine/sherpa.ts";

const USAGE = "usage: npm run local:transcribe -- <audio> [--model parakeet-v3] [--compare <file.txt|file.json>] [--threshold 0.5] [--models <dir>] [--threads N]\n" +
  `  --model: ${SPEECH_MODELS.map((m) => m.id).join(", ")} (default ${DEFAULT_SPEECH})\n` +
  "  --threshold: lower (0.4) if two people came out as one voice, higher (0.6) if one person came out as several";

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const pad = (n: number) => String(n).padStart(2, "0");
  return t >= 3600 ? `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}` : `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const status = (line: string) => process.stderr.write(`\r\x1b[2K${line}`);

/** Same layout as the app's TXT export, so both open side by side and the comparison can read either. */
function toTxt(t: LocalTranscript): string {
  const name = (n: number) => es.speakers.default.replace("{n}", String(n + 1));
  return t.blocks.map((b) => `[${clock(b.start)}] ${name(b.speaker)}:\n${b.text}\n`).join("\n");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      threshold: { type: "string" },
      model: { type: "string" },
      compare: { type: "string" },
      models: { type: "string" },
      threads: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  // npm runs scripts from the repo root; INIT_CWD is where the person typed the command.
  const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
  const audio = here(positionals[0]!);
  const threshold = values.threshold ? Number(values.threshold) : DEFAULT_THRESHOLD;
  if (!(threshold > 0 && threshold < 1)) throw new Error("--threshold must be between 0 and 1, for example 0.5");
  const threads = values.threads ? Number(values.threads) : Math.min(8, availableParallelism());

  const model = speechModel(values.model ?? DEFAULT_SPEECH);
  if (!model) throw new Error(`--model must be one of: ${SPEECH_MODELS.map((m) => m.id).join(", ")}`);
  const dir = await ensureModels(values.models ? here(values.models) : defaultModelsDir(), {
    files: filesFor(model.id),
    onProgress: (done, total) => status(`Downloading models (once): ${Math.round(done / 1e6)} of ${Math.round(total / 1e6)} MB`),
  });
  status("Reading audio...");
  const samples = await decodeAudio(audio);
  const seconds = samples.length / SAMPLE_RATE;
  const started = performance.now();
  status(`Separating voices in ${clock(seconds)} of audio...`);
  const t = transcribe(sherpaEngine(dir, threads, undefined, model.id), samples, threshold, {
    separated: (voices) => status(`Found ${voices} voices. Transcribing...`),
    recognized: (done, total) => status(`Transcribing: ${done} of ${total} turns`),
  });
  const took = (performance.now() - started) / 1000;

  const base = audio.slice(0, audio.length - extname(audio).length);
  await writeFile(`${base}.local.json`, `${JSON.stringify(t, null, 1)}\n`);
  await writeFile(`${base}.local.txt`, toTxt(t));
  status("");
  console.log(`Done: ${clock(seconds)} of audio in ${clock(took)} (${(took / seconds).toFixed(2)}x), ${new Set(t.blocks.map((b) => b.speaker)).size} voices.`);
  console.log(`Saved ${basename(base)}.local.txt and ${basename(base)}.local.json next to the audio.`);

  if (values.compare) {
    const file = here(values.compare);
    const ref = readReference(file, await readFile(file, "utf8"));
    const local = t.blocks.map((b) => ({ speaker: String(b.speaker), start: b.start, end: b.end, text: b.text }));
    const c = compare(ref, local);
    console.log(`Compared with ${basename(file)}: ${pct(c.wordsAlike)} of words alike, ${pct(c.voicesAlike)} of speech time on the same voice (${c.localVoices} local voices, ${c.referenceVoices} in the reference).`);
    console.log("Neither side is ground truth: read both TXT files to see which one is right where they differ.");
  }
  console.log(`Models: ${CREDITS.join("; ")}.`);
}

main().catch((e: unknown) => {
  status("");
  console.error(`error: ${(e as Error).message}`);
  process.exitCode = 1;
});
