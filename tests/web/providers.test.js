import { describe, expect, it } from "vitest";
import { keySource, usableProvider } from "../../src/web/lib/providers";
import { toJson } from "../../src/web/lib/format";

const me = (over = {}) => ({
  provider: "deepgram",
  consents: [],
  hosted: { remainingSeconds: 600, capSeconds: 72000 },
  providers: [
    { id: "deepgram", ownKey: null, hosted: true },
    { id: "assemblyai", ownKey: { last4: "1234" }, hosted: false },
    { id: "openai", ownKey: null, hosted: false },
  ],
  ...over,
});

describe("which key pays", () => {
  it("prefers the person's own key, then the hosted one while minutes remain", () => {
    expect(keySource(me(), "assemblyai")).toBe("own");
    expect(keySource(me(), "deepgram")).toBe("hosted");
    expect(keySource(me({ hosted: { remainingSeconds: 0, capSeconds: 1 } }), "deepgram")).toBeNull();
    expect(keySource(me(), "openai")).toBeNull();
  });

  it("falls back to a provider that has a key", () => {
    expect(usableProvider(me())).toBe("deepgram");
    expect(usableProvider(me({ provider: "openai" }))).toBe("deepgram");
    expect(usableProvider(me({ hosted: null }))).toBe("assemblyai");
  });
});

describe("JSON export of a meeting", () => {
  it("uses the open transcript format with names", () => {
    const out = JSON.parse(
      toJson({ title: "Junta", date: "2026-11-05T15:00:00Z", duration: 9, speakerNames: { 0: "Ana" }, transcript: { provider: "deepgram", model: "nova-3" }, utterances: [{ speaker: 0, start: 0, end: 2, text: "Hola" }] }),
    );
    expect(out).toMatchObject({ format: "minuteca-transcript", version: 1, provider: "deepgram", speakerNames: { 0: "Ana" } });
    expect(out.blocks).toEqual([{ speaker: 0, start: 0, end: 2, text: "Hola" }]);
  });
});
