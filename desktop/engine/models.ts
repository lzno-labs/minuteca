// Local models: downloaded once from pinned Hugging Face revisions and checked by SHA-256
// before use (ADR-0005). The speech model is chosen per computer (ADR-0007); speaker separation
// models are shared. Nothing here runs a model.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ModelFile {
  /** Path inside the models folder. */
  name: string;
  url: string;
  sha256: string;
  size: number;
}

const HF = "https://huggingface.co";
const PARAKEET = `${HF}/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/ed5d745623472f97cfc2e6c2916ee248798fc5a8`;
const SEGMENTATION = `${HF}/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0`;
const EMBEDDING = `${HF}/csukuangfj/speaker-embedding-models/resolve/0743f301363dec56491a490f6d6cbc9d67f9a3bf`;

const SPEAKERS_NAME = "pyannote-segmentation-3.0+wespeaker-resnet34-lm";

/** Speaker separation: the same for every speech model. */
export const SPEAKER_FILES: readonly ModelFile[] = [
  { name: "segmentation/model.onnx", url: `${SEGMENTATION}/model.onnx`, size: 5_992_913, sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079" },
  { name: "embedding/wespeaker_en_voxceleb_resnet34_LM.onnx", url: `${EMBEDDING}/wespeaker_en_voxceleb_resnet34_LM.onnx`, size: 26_530_550, sha256: "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012" },
];

export type SpeechModelId = "parakeet-v3" | "whisper-turbo" | "whisper-small" | "whisper-base";

export interface SpeechModel {
  id: SpeechModelId;
  /** Its own name, the same in every language. */
  name: string;
  kind: "parakeet" | "whisper";
  /** Folder inside the models folder. */
  folder: string;
  /** In the transcript's `model` field, before the speaker models. */
  label: string;
  files: readonly ModelFile[];
  /** Total memory a computer should have for it, in GB. */
  minMemoryGb: number;
  /** Seconds of work per second of audio with 4 threads, measured on 2026-11-12 (ADR-0007). */
  realTime: number;
  credit: string;
}

/** Whisper's ONNX exports for sherpa-onnx: two files per size, and one shared token list. */
const whisper = (size: "turbo" | "small" | "base", revision: string, encoder: [number, string], decoder: [number, string]): ModelFile[] => {
  const base = `${HF}/csukuangfj/sherpa-onnx-whisper-${size}/resolve/${revision}`;
  return [
    { name: `whisper-${size}/encoder.int8.onnx`, url: `${base}/${size}-encoder.int8.onnx`, size: encoder[0], sha256: encoder[1] },
    { name: `whisper-${size}/decoder.int8.onnx`, url: `${base}/${size}-decoder.int8.onnx`, size: decoder[0], sha256: decoder[1] },
    { name: `whisper-${size}/tokens.txt`, url: `${base}/${size}-tokens.txt`, size: 816_730, sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126" },
  ];
};

const WHISPER_CREDIT = "OpenAI Whisper (MIT), ONNX export by the sherpa-onnx project";

export const SPEECH_MODELS: readonly SpeechModel[] = [
  {
    id: "parakeet-v3",
    name: "Parakeet v3",
    kind: "parakeet",
    folder: "parakeet",
    label: "parakeet-tdt-0.6b-v3-int8",
    files: [
      { name: "parakeet/encoder.int8.onnx", url: `${PARAKEET}/encoder.int8.onnx`, size: 652_282_294, sha256: "1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479" },
      { name: "parakeet/decoder.int8.onnx", url: `${PARAKEET}/decoder.int8.onnx`, size: 11_845_274, sha256: "0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5" },
      { name: "parakeet/joiner.int8.onnx", url: `${PARAKEET}/joiner.int8.onnx`, size: 6_355_277, sha256: "cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98" },
      { name: "parakeet/tokens.txt", url: `${PARAKEET}/tokens.txt`, size: 93_939, sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d" },
    ],
    minMemoryGb: 8,
    realTime: 0.18,
    credit: "NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), ONNX export by the sherpa-onnx project",
  },
  {
    id: "whisper-turbo",
    name: "Whisper turbo",
    kind: "whisper",
    folder: "whisper-turbo",
    label: "whisper-large-v3-turbo-int8",
    files: whisper("turbo", "2ca6ff69fc878651b770880507669577ac41c2ff", [674_716_297, "b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b"], [361_080_764, "20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547"]),
    minMemoryGb: 12,
    realTime: 0.43,
    credit: WHISPER_CREDIT,
  },
  {
    id: "whisper-small",
    name: "Whisper small",
    kind: "whisper",
    folder: "whisper-small",
    label: "whisper-small-int8",
    files: whisper("small", "8f3c18b358db4d1f2fc1eae49d75cd20989e4309", [112_442_483, "4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9"], [262_226_114, "acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee"]),
    minMemoryGb: 6,
    realTime: 0.49,
    credit: WHISPER_CREDIT,
  },
  {
    id: "whisper-base",
    name: "Whisper base",
    kind: "whisper",
    folder: "whisper-base",
    label: "whisper-base-int8",
    files: whisper("base", "bb53ee204431c90d314c1cc08d28d23e5b7927cc", [29_120_534, "0b8fb1304b6109976038efff5ace81720e00386f3ff6b54ee8c75291ca0a1e11"], [130_672_026, "9759d217388a01b3a4c7c15533201067b48ae819c4daafc8624e64b9409dc02d"]),
    minMemoryGb: 4,
    realTime: 0.23,
    credit: WHISPER_CREDIT,
  },
];

export const DEFAULT_SPEECH: SpeechModelId = "parakeet-v3";

/** The catalog entry for an id the web or the command line sent, or null for anything else. */
export const speechModel = (id: unknown): SpeechModel | null => SPEECH_MODELS.find((m) => m.id === id) ?? null;

/** Everything a speech model needs: its files and the speaker models. */
export const filesFor = (id: SpeechModelId = DEFAULT_SPEECH): readonly ModelFile[] => [...speechModel(id)!.files, ...SPEAKER_FILES];

/** Stored in the transcript's `model` field. */
export const modelName = (id: SpeechModelId = DEFAULT_SPEECH) => `${speechModel(id)!.label}+${SPEAKERS_NAME}`;
export const MODEL_NAME = modelName();

/** Parakeet's files and the speaker models (what ADR-0005 shipped). */
export const MODEL_FILES: readonly ModelFile[] = filesFor();

/** Licenses that ask for credit (shown by the command and in the app's Settings). */
export const CREDITS = [
  ...new Set(SPEECH_MODELS.map((m) => m.credit)),
  "pyannote segmentation 3.0 (MIT), ONNX export by the sherpa-onnx project",
  "WeSpeaker ResNet34-LM trained on VoxCeleb (CC-BY-4.0)",
] as const;

export const defaultModelsDir = () => process.env.MINUTECA_MODELS || join(homedir(), ".cache", "minuteca", "models");

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const sizeOf = async (path: string) => (await stat(path).catch(() => null))?.size ?? -1;

/** A file counts as present when its size matches and a marker records that its hash was checked. */
async function present(dir: string, f: ModelFile): Promise<boolean> {
  if ((await sizeOf(join(dir, f.name))) !== f.size) return false;
  return (await readFile(join(dir, `${f.name}.sha256`), "utf8").catch(() => "")).trim() === f.sha256;
}

export interface EnsureOptions {
  onProgress?: (done: number, total: number) => void;
  files?: readonly ModelFile[];
  fetcher?: typeof fetch;
}

/** Downloads what is missing (resuming partial files) and verifies every file. Returns the folder. */
export async function ensureModels(dir: string, { onProgress, files = MODEL_FILES, fetcher = fetch }: EnsureOptions = {}): Promise<string> {
  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  for (const f of files) {
    const path = join(dir, f.name);
    if (await present(dir, f)) {
      done += f.size;
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    // A file copied in by hand (or left without its marker) is checked instead of downloaded again.
    if ((await sizeOf(path)) === f.size && (await sha256File(path)) === f.sha256) {
      await writeFile(`${path}.sha256`, `${f.sha256}\n`);
      done += f.size;
      continue;
    }
    const part = `${path}.part`;
    let have = Math.max(0, await sizeOf(part));
    if (have > f.size) {
      await rm(part);
      have = 0;
    }
    if (have < f.size) {
      const res = await fetcher(f.url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`download failed for ${f.name}: HTTP ${res.status}`);
      if (res.status !== 206) have = 0;
      let got = have;
      const counted = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).on("data", (chunk: Buffer) => {
        got += chunk.length;
        onProgress?.(done + got, total);
      });
      await pipeline(counted, createWriteStream(part, { flags: have ? "a" : "w" }));
    }
    const sha = await sha256File(part);
    if (sha !== f.sha256) {
      await rm(part, { force: true });
      throw new Error(`${f.name} did not match its checksum; it was deleted, run again to download it`);
    }
    await rename(part, path);
    await writeFile(`${path}.sha256`, `${f.sha256}\n`);
    done += f.size;
    onProgress?.(done, total);
  }
  return dir;
}

export const modelPath = (dir: string, name: string) => join(dir, name);

/** The speech models whose files (and the speaker models) are all here and checked. */
export async function downloadedModels(dir: string): Promise<SpeechModelId[]> {
  const out: SpeechModelId[] = [];
  for (const m of SPEECH_MODELS) {
    const all = await Promise.all(filesFor(m.id).map((f) => present(dir, f)));
    if (all.every(Boolean)) out.push(m.id);
  }
  return out;
}

/** Deletes one speech model's files (and partial downloads). The shared speaker models stay. */
export async function deleteSpeechModel(dir: string, id: SpeechModelId): Promise<void> {
  const m = speechModel(id);
  if (!m) return;
  for (const f of m.files) {
    for (const suffix of ["", ".sha256", ".part"]) await rm(join(dir, `${f.name}${suffix}`), { force: true });
  }
  await rmdir(join(dir, m.folder)).catch(() => {});
}
