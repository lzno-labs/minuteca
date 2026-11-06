import { describe, expect, it } from "vitest";
import { toBase64 } from "../../src/server/crypto.ts";
import { parseRange } from "../../src/server/files/files.ts";
import { pickLanguage, t } from "../../src/server/i18n.ts";
import { KeyVault } from "../../src/server/keys.ts";
import { fromAssemblyai } from "../../src/server/transcriber/assemblyai.ts";
import { deepgram, deepgramParams, fromDeepgram } from "../../src/server/transcriber/deepgram.ts";
import { fromOpenai, openai } from "../../src/server/transcriber/openai.ts";
import { ProviderError, withSpeakers } from "../../src/server/transcriber/transcriber.ts";
import { transcript } from "./helpers.ts";

describe("key vault", () => {
  const vault = KeyVault.fromEnv(toBase64(new Uint8Array(32).fill(3)))!;

  it("round trips and binds the key to its owner and provider", async () => {
    const sealed = await vault.seal("user-1", "deepgram", "secret-key-1234");
    expect(sealed.last4).toBe("1234");
    expect(sealed.ciphertext).not.toContain("secret");
    expect(await vault.open("user-1", "deepgram", sealed)).toBe("secret-key-1234");
    await expect(vault.open("user-2", "deepgram", sealed)).rejects.toThrow();
    await expect(vault.open("user-1", "openai", sealed)).rejects.toThrow();
  });

  it("rejects a server key of the wrong size", () => {
    expect(() => KeyVault.fromEnv(toBase64(new Uint8Array(16)))).toThrow(/32 bytes/);
    expect(KeyVault.fromEnv(undefined)).toBeNull();
  });
});

describe("byte ranges", () => {
  it("parses the forms browsers send", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ offset: 0, length: 100 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ offset: 10, length: 10 });
    expect(parseRange("bytes=-10", 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("items=1-2", 100)).toBe("invalid");
  });
});

describe("provider adapters", () => {
  it("returns the provider's answer untouched, for the server or the browser to convert", async () => {
    const body = JSON.stringify({ metadata: { duration: 3 }, results: { channels: [{ alternatives: [{ words: [] }] }] } });
    const tr = deepgram(async () => new Response(body));
    const r = await tr.start({ size: 1, contentType: "audio/webm", bytes: async () => new Uint8Array(1) }, { apiKey: "k" });
    expect(r.status).toBe("done");
    expect(new TextDecoder().decode((r as { raw: Uint8Array }).raw)).toBe(body);
    expect(tr.fromRaw(JSON.parse(body)).duration).toBe(3);
  });

  it("asks Deepgram not to use the audio for training", () => {
    const p = deepgramParams("es", "https://x/cb");
    expect(p.get("mip_opt_out")).toBe("true");
    expect(p.get("diarize")).toBe("true");
    expect(p.get("language")).toBe("es");
    expect(p.get("callback")).toBe("https://x/cb");
    expect(deepgramParams().get("detect_language")).toBe("true");
  });

  it("reads Deepgram paragraphs, utterances or words into blocks", () => {
    const paragraphs = fromDeepgram({
      metadata: { duration: 12.3456 },
      results: { channels: [{ detected_language: "es", alternatives: [{ paragraphs: { paragraphs: [
        { speaker: 0, start: 0, end: 3, sentences: [{ start: 0, end: 3, text: "Hola." }] },
        { speaker: 1, start: 3, end: 6, sentences: [{ start: 3, end: 6, text: "Buenas." }] },
      ] } }] }] },
    });
    expect(paragraphs).toMatchObject({ format: "minuteca-transcript", version: 1, provider: "deepgram", language: "es", duration: 12.346 });
    expect(paragraphs.blocks.map((b) => [b.speaker, b.text])).toEqual([[0, "Hola."], [1, "Buenas."]]);
    const words = fromDeepgram({ results: { channels: [{ alternatives: [{ words: [
      { word: "a", punctuated_word: "A", speaker: 0, start: 0, end: 0.5 },
      { word: "b", speaker: 0, start: 0.6, end: 1 },
      { word: "c", speaker: 1, start: 1.2, end: 1.5 },
    ] }] }] } });
    expect(words.blocks.map((b) => b.text)).toEqual(["A b", "c"]);
  });

  it("maps AssemblyAI and OpenAI speakers in order of appearance", () => {
    const a = fromAssemblyai({ audio_duration: 9, language_code: "es", utterances: [
      { speaker: "B", start: 0, end: 1500, text: "Uno" },
      { speaker: "A", start: 1500, end: 3000, text: "Dos" },
      { speaker: "B", start: 3000, end: 4000, text: "Tres" },
    ] });
    expect(a.blocks.map((b) => [b.speaker, b.start, b.text])).toEqual([[0, 0, "Uno"], [1, 1.5, "Dos"], [0, 3, "Tres"]]);
    const o = fromOpenai({ duration: 5, segments: [
      { speaker: "A", start: 0, end: 1, text: "Hola" },
      { speaker: "A", start: 1.2, end: 2, text: "otra vez" },
      { speaker: "B", start: 2, end: 3, text: "Sí" },
    ] }, "es");
    expect(o.blocks.map((b) => [b.speaker, b.text])).toEqual([[0, "Hola otra vez"], [1, "Sí"]]);
    expect(o.language).toBe("es");
  });

  it("never sends more than 25 MB to OpenAI", async () => {
    const tr = openai(async () => new Response("{}"));
    await expect(tr.start({ size: 26 * 1024 * 1024, contentType: "audio/mp4", bytes: async () => new Uint8Array() }, { apiKey: "k" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("turns provider errors into codes without their bodies", async () => {
    const tr = deepgram(async () => new Response("secret details", { status: 401 }));
    const e = await tr.start({ size: 1, contentType: "audio/webm", bytes: async () => new Uint8Array(1) }, { apiKey: "k" }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe("invalid_key");
    expect(e.message).not.toContain("secret");
  });

  it("only lets the speaker of a block change", () => {
    const tr = transcript();
    expect(withSpeakers(tr, [1, 1])!.blocks.map((b) => b.speaker)).toEqual([1, 1]);
    expect(withSpeakers(tr, [1])).toBeNull();
    expect(withSpeakers(tr, [-1, 0])).toBeNull();
  });
});

describe("server texts", () => {
  it("speaks Spanish by default", () => {
    expect(pickLanguage(undefined)).toBe("es");
    expect(pickLanguage("fr-FR,fr;q=0.9")).toBe("es");
    expect(pickLanguage("en-US,en;q=0.9")).toBe("en");
    expect(t("es", "mail.signIn.body", { link: "L", minutes: 30 })).toContain("L");
  });
});
