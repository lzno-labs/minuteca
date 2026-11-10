import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  SAMPLE_RATE, parseWav, quietestPoint, s16leToFloat, sentencesFrom, splitLong, toBlocks, windowsFrom,
} from "../../desktop/engine/blocks.ts";
import { compare, parseTxt, readReference, speakerAgreement, wordErrorRate, words } from "../../desktop/engine/compare.ts";
import { MODEL_FILES, ensureModels } from "../../desktop/engine/models.ts";
import { type Engine, transcribe } from "../../desktop/engine/pipeline.ts";
import { isTranscript } from "../../src/server/transcriber/transcriber.ts";

const seg = (speaker: number, start: number, end: number) => ({ speaker, start, end });

describe("windows and blocks", () => {
  it("joins nearby turns of the same voice and keeps other voices apart", () => {
    const w = windowsFrom([seg(0, 0, 2), seg(0, 2.5, 4), seg(1, 4.2, 6), seg(0, 6.1, 7), seg(0, 9, 10), seg(1, 10, 10)]);
    expect(w).toEqual([seg(0, 0, 4), seg(1, 4.2, 6), seg(0, 6.1, 7), seg(0, 9, 10)]);
  });

  it("never lets a window grow past the limit", () => {
    expect(windowsFrom([seg(0, 0, 20), seg(0, 20.5, 40)], { maxSeconds: 30 })).toHaveLength(2);
  });

  it("cuts long windows at the quietest moment", () => {
    const samples = new Float32Array(SAMPLE_RATE * 70).fill(0.5);
    samples.fill(0, SAMPLE_RATE * 25, SAMPLE_RATE * 25.2);
    expect(quietestPoint(samples, 20, 30)).toBeCloseTo(25.05, 1);
    const parts = splitLong([seg(3, 0, 70)], samples, 30);
    expect(parts[0]).toEqual({ speaker: 3, start: 0, end: expect.closeTo(25.05, 1) });
    expect(parts.every((p) => p.end - p.start <= 30 && p.speaker === 3)).toBe(true);
    expect(parts.at(-1)!.end).toBe(70);
  });

  it("builds sentences from tokens with times", () => {
    const r = { text: "Hola. ¿Todo bien?", tokens: [" Ho", "la", ".", " ¿", "Todo", " bien", "?"], timestamps: [0, 0.2, 0.4, 1, 1.1, 1.3, 1.6], durations: [0.2, 0.2, 0.1, 0.1, 0.2, 0.3, 0.1] };
    expect(sentencesFrom(r, 10)).toEqual([{ start: 10, end: 10.5, text: "Hola." }, { start: 11, end: 11.7, text: "¿Todo bien?" }]);
    expect(sentencesFrom({ text: "sin punto", tokens: [" sin", " punto"], timestamps: [0, 0.5] }, 0)).toEqual([{ start: 0, end: 0.5, text: "sin punto" }]);
  });

  it("merges a voice's consecutive pieces and numbers voices by first appearance", () => {
    const p = (speaker: number, start: number, end: number, text: string) => ({ speaker, start, end, text, sentences: [{ start, end, text }] });
    const blocks = toBlocks([p(5, 0, 2, "Hola."), p(5, 2.5, 4, "¿Cómo están?"), p(2, 4.5, 6, " "), p(2, 6, 7, "Bien."), p(5, 7.5, 8, "Bueno.")]);
    expect(blocks.map((b) => [b.speaker, b.text])).toEqual([[0, "Hola. ¿Cómo están?"], [1, "Bien."], [0, "Bueno."]]);
    expect(blocks[0]!.sentences).toHaveLength(2);
  });
});

describe("audio bytes", () => {
  it("reads 16-bit PCM and mono WAV files", () => {
    expect([...s16leToFloat(new Uint8Array([0, 0, 0, 64, 0, 128]))]).toEqual([0, 0.5, -1]);
    const data = new Uint8Array([0, 64, 0, 192]);
    const wav = new Uint8Array(44 + data.length);
    const v = new DataView(wav.buffer);
    wav.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    v.setUint32(4, 36 + data.length, true);
    wav.set([..."WAVEfmt "].map((c) => c.charCodeAt(0)), 8);
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    wav.set([..."data"].map((c) => c.charCodeAt(0)), 36);
    v.setUint32(40, data.length, true);
    wav.set(data, 44);
    expect(parseWav(wav)).toEqual({ sampleRate: 16000, samples: new Float32Array([0.5, -0.5]) });
    v.setUint16(22, 2, true);
    expect(() => parseWav(wav)).toThrow("mono");
    expect(() => parseWav(new Uint8Array(4))).toThrow("not a WAV");
  });
});

describe("pipeline", () => {
  it("returns a transcript the server accepts, with the local provider", () => {
    const engine: Engine = {
      diarize: (_samples, threshold) => (threshold === 0.4 ? [seg(7, 0, 1.5), seg(4, 2, 3)] : []),
      recognize: (s) => ({ text: s.length > SAMPLE_RATE ? "Primera parte." : "Segunda.", tokens: [" Primera", " parte", "."], timestamps: [0, 0.5, 1], durations: [0.4, 0.4, 0.1] }),
    };
    const steps: string[] = [];
    const t = transcribe(engine, new Float32Array(SAMPLE_RATE * 3), 0.4, {
      separated: (v, w) => steps.push(`voices ${v} windows ${w}`),
      recognized: (d, n) => steps.push(`${d}/${n}`),
    });
    expect(isTranscript(t)).toBe(true);
    expect(t).toMatchObject({ provider: "local", language: null, duration: 3 });
    expect(t.model).toContain("parakeet-tdt-0.6b-v3");
    expect(t.blocks.map((b) => [b.speaker, b.start, b.text])).toEqual([[0, 0, "Primera parte."], [1, 2, "Segunda."]]);
    expect(t.blocks[1]!.sentences![0]!.start).toBe(2);
    expect(steps).toEqual(["voices 2 windows 2", "1/2", "2/2"]);
  });
});

describe("comparison with a cloud transcript", () => {
  const txt = [
    "Reunión", "Fecha: lunes", "", "=".repeat(60), "",
    "[00:00] Ana:", "Buenos días.", "Empezamos.", "",
    "[00:05] Persona 2:", "Gracias, Ana.", "",
    "[01:00:10] Ana:", "Se levanta la sesión.", "",
  ].join("\n");

  it("reads the TXT export, the Firebase version's included", () => {
    expect(parseTxt(txt)).toEqual([
      { speaker: "Ana", start: 0, end: 5, text: "Buenos días. Empezamos." },
      { speaker: "Persona 2", start: 5, end: 3610, text: "Gracias, Ana." },
      { speaker: "Ana", start: 3610, end: expect.closeTo(3612, 0), text: "Se levanta la sesión." },
    ]);
  });

  it("reads minuteca JSON and raw Deepgram answers", () => {
    const t = { format: "minuteca-transcript", version: 1, blocks: [{ speaker: 1, start: 0, end: 2, text: "Hola." }] };
    expect(readReference("a.json", JSON.stringify(t))).toEqual([{ speaker: "1", start: 0, end: 2, text: "Hola." }]);
    expect(readReference("meeting.json", JSON.stringify({ id: "m1", transcript: t }))).toHaveLength(1);
    const dg = { results: { channels: [{ alternatives: [{ words: [{ word: "hola", speaker: 0, start: 0, end: 0.5 }, { word: "adiós", speaker: 1, start: 1, end: 1.5 }] }] }] } };
    expect(readReference("dg.json", JSON.stringify(dg)).map((b) => b.speaker)).toEqual(["0", "1"]);
    expect(() => readReference("x.json", "{}")).toThrow("unknown JSON");
  });

  it("measures how alike the words and the voices are", () => {
    expect(words("¡Hola, Ana! ¿Qué tal?")).toEqual(["hola", "ana", "qué", "tal"]);
    expect(wordErrorRate(["a", "b", "c", "d"], ["a", "x", "c"])).toBe(0.5);
    expect(wordErrorRate([], [])).toBe(0);
    const ref = [{ speaker: "Ana", start: 0, end: 10, text: "" }, { speaker: "Luis", start: 10, end: 20, text: "" }];
    const swapped = [{ speaker: "1", start: 0, end: 10, text: "" }, { speaker: "0", start: 10, end: 20, text: "" }];
    expect(speakerAgreement(ref, swapped)).toBe(1);
    const merged = [{ speaker: "0", start: 0, end: 20, text: "" }];
    expect(speakerAgreement(ref, merged)).toBe(0.5);
    const c = compare([{ speaker: "Ana", start: 0, end: 4, text: "Buenos días a todos" }], [{ speaker: "0", start: 0, end: 4, text: "buenos días todos" }]);
    expect(c).toEqual({ wordsAlike: 0.75, voicesAlike: 1, localVoices: 1, referenceVoices: 1 });
  });
});

describe("models", () => {
  let dir = "";
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("pins every file to a revision and a checksum", () => {
    for (const f of MODEL_FILES) {
      expect(f.url).toMatch(/^https:\/\/huggingface\.co\/csukuangfj\/[\w.-]+\/resolve\/[0-9a-f]{40}\//);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.size).toBeGreaterThan(0);
    }
  });

  it("downloads what is missing, resumes partial files, checks copies and refuses a wrong checksum", async () => {
    dir = await mkdtemp(join(tmpdir(), "minuteca-models-"));
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const tokens = new TextEncoder().encode("tokens");
    const model = new TextEncoder().encode("model bytes");
    const files = [
      { name: "a/tokens.txt", url: "https://example.org/tokens.txt", size: tokens.length, sha256: sha(tokens) },
      { name: "b/model.onnx", url: "https://example.org/model.onnx", size: model.length, sha256: sha(model) },
    ];
    await mkdir(join(dir, "a"), { recursive: true });
    await mkdir(join(dir, "b"), { recursive: true });
    await writeFile(join(dir, "a/tokens.txt.part"), tokens.subarray(0, 3));
    await writeFile(join(dir, "b/model.onnx"), model);
    const asked: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      asked.push(`${url} ${(init?.headers as Record<string, string>).Range ?? ""}`);
      return new Response(tokens.subarray(3), { status: 206 });
    }) as typeof fetch;
    const progress: number[] = [];
    await ensureModels(dir, { files, fetcher, onProgress: (d) => progress.push(d) });
    expect(asked).toEqual(["https://example.org/tokens.txt bytes=3-"]);
    expect(await readFile(join(dir, "a/tokens.txt"), "utf8")).toBe("tokens");
    expect(await readFile(join(dir, "b/model.onnx.sha256"), "utf8")).toBe(`${sha(model)}\n`);
    expect(progress.at(-1)).toBe(tokens.length);

    // Present files are not fetched again.
    await ensureModels(dir, { files, fetcher });
    expect(asked).toHaveLength(1);

    await rm(join(dir, "a/tokens.txt"));
    const bad = (async () => new Response("TOKENS", { status: 200 })) as unknown as typeof fetch;
    await expect(ensureModels(dir, { files, fetcher: bad })).rejects.toThrow("checksum");
    await expect(stat(join(dir, "a/tokens.txt.part"))).rejects.toThrow();
  });
});
