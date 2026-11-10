// Audio file to 16 kHz mono samples for the command-line engine. It uses ffmpeg when installed and,
// on a Mac, afconvert (built in; no WebM). The desktop app will decode with Chromium instead (ADR-0005).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_RATE, parseWav, s16leToFloat } from "./blocks.ts";

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(-300)}`))));
  });
}

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

export async function decodeAudio(file: string): Promise<Float32Array> {
  try {
    const raw = await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"]);
    return s16leToFloat(raw);
  } catch (e) {
    if (!missing(e)) throw e;
  }
  if (process.platform === "darwin") {
    const dir = await mkdtemp(join(tmpdir(), "minuteca-"));
    try {
      await run("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "1", file, join(dir, "audio.wav")]);
      return parseWav(await readFile(join(dir, "audio.wav"))).samples;
    } catch (e) {
      throw new Error(`could not decode ${file} with afconvert (WebM needs ffmpeg: brew install ffmpeg). ${(e as Error).message}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  throw new Error("ffmpeg is needed to read audio files: install it and run again");
}
