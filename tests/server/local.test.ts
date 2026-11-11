import { afterEach, describe, expect, it } from "vitest";
import { ADMIN, setup, transcript } from "./helpers.ts";

let t: ReturnType<typeof setup>;
afterEach(() => t?.cleanup());

/** A transcript made by the desktop app (ADR 0005). */
const local = () => ({ ...transcript(), provider: "local", model: "parakeet-tdt-0.6b-v3-int8+pyannote-segmentation-3.0+wespeaker-resnet34-lm", language: null });

describe("desktop app", () => {
  it("asks for its own sign-in link, with the desktop words in the mail", async () => {
    t = setup();
    await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: ADMIN, client: "app", challenge: "A".repeat(43), device: "desktop" }) });
    expect(t.mails[0]!.text).toContain("&app=desktop");
    expect(t.mails[0]!.text).toContain("computadora");
    // The device only changes words: a web link stays a web link.
    await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: ADMIN, device: "desktop" }) });
    expect(t.mails[1]!.text).not.toContain("&app=");
  });

  it("saves a transcript made on the computer, with no key or permission", async () => {
    t = setup();
    const token = await t.appSignIn();
    const id = await t.meetingWithAudio(await t.signIn());
    const r = await t.fetch(`/api/meetings/${id}/transcript/local`, { method: "PUT", bearer: token, body: JSON.stringify({ transcript: local() }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id, status: "done", provider: "local", keySource: null, speakerNames: {} });
    const m = await (await t.fetch(`/api/meetings/${id}`, { bearer: token })).json();
    expect(m.transcript).toMatchObject({ provider: "local", blocks: expect.any(Array) });
    expect(Object.values(t.tr).every((x) => x.calls.length === 0)).toBe(true);

    // Transcribing again replaces it and the voice names start over.
    const named = await t.fetch(`/api/meetings/${id}`, { method: "PATCH", bearer: token, body: JSON.stringify({ speakerNames: { "0": "Ana" } }) });
    expect((await named.json()).speakerNames).toEqual({ "0": "Ana" });
    const again = await t.fetch(`/api/meetings/${id}/transcript/local`, { method: "PUT", bearer: token, body: JSON.stringify({ transcript: local() }) });
    expect((await again.json()).speakerNames).toEqual({});
  });

  it("refuses transcripts from other providers, meetings without audio and empty answers", async () => {
    t = setup();
    const cookie = await t.signIn();
    const id = await t.meetingWithAudio(cookie);
    const put = (body: unknown, meeting = id) => t.fetch(`/api/meetings/${meeting}/transcript/local`, { method: "PUT", cookie, body: JSON.stringify(body) });
    expect((await put({ transcript: transcript() })).status).toBe(400);
    expect((await put({ transcript: { ...local(), blocks: [], duration: 0 } })).status).toBe(400);
    expect((await put({ transcript: "nope" })).status).toBe(400);
    const empty = crypto.randomUUID();
    await t.fetch("/api/meetings", { method: "POST", cookie, body: JSON.stringify({ id: empty, title: "Sin audio" }) });
    const r = await put({ transcript: local() }, empty);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "not_ready" });
    expect((await put({ transcript: local() }, crypto.randomUUID())).status).toBe(404);
  });
});
