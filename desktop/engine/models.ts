// Local models: downloaded once from pinned Hugging Face revisions and checked by SHA-256
// before use (ADR-0005). Nothing here runs a model.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

/** Stored in the transcript's `model` field. */
export const MODEL_NAME = "parakeet-tdt-0.6b-v3-int8+pyannote-segmentation-3.0+wespeaker-resnet34-lm";

export const MODEL_FILES: readonly ModelFile[] = [
  { name: "parakeet/encoder.int8.onnx", url: `${PARAKEET}/encoder.int8.onnx`, size: 652_282_294, sha256: "1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479" },
  { name: "parakeet/decoder.int8.onnx", url: `${PARAKEET}/decoder.int8.onnx`, size: 11_845_274, sha256: "0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5" },
  { name: "parakeet/joiner.int8.onnx", url: `${PARAKEET}/joiner.int8.onnx`, size: 6_355_277, sha256: "cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98" },
  { name: "parakeet/tokens.txt", url: `${PARAKEET}/tokens.txt`, size: 93_939, sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d" },
  { name: "segmentation/model.onnx", url: `${SEGMENTATION}/model.onnx`, size: 5_992_913, sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079" },
  { name: "embedding/wespeaker_en_voxceleb_resnet34_LM.onnx", url: `${EMBEDDING}/wespeaker_en_voxceleb_resnet34_LM.onnx`, size: 26_530_550, sha256: "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012" },
];

/** Licenses that ask for credit (shown by the command and, later, in the app's "Acerca de"). */
export const CREDITS = [
  "NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), ONNX export by the sherpa-onnx project",
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
