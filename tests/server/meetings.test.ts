import { afterEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

let t: ReturnType<typeof setup>;
afterEach(() => t?.cleanup());

describe("meetings", () => {
  it("creates idempotently, uploads audio and serves byte ranges", async () => {
    t = setup();
    const cookie = await t.signIn();
    const id = await t.meetingWithAudio(cookie, crypto.randomUUID(), 1000);
    const again = await t.fetch("/api/meetings", { method: "POST", cookie, body: JSON.stringify({ id, title: "Otra" }) });
    expect((await again.json()).title).toBe("Junta");
    const list = (await (await t.fetch("/api/meetings", { cookie })).json()).meetings;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, status: "uploaded", hasAudio: true, audioBytes: 1000, audioType: "audio/webm" });

    const part = await t.fetch(`/api/meetings/${id}/audio`, { cookie, headers: { Range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    const whole = await t.fetch(`/api/meetings/${id}/audio`, { cookie });
    expect((await whole.arrayBuffer()).byteLength).toBe(1000);
  });

  it("refuses uploads that are not audio, too large or without a length", async () => {
    t = setup({ env: { MINUTECA_MAX_AUDIO_MB: "1" } });
    const cookie = await t.signIn();
    const id = crypto.randomUUID();
    await t.fetch("/api/meetings", { method: "POST", cookie, body: JSON.stringify({ id }) });
    const notAudio = await t.fetch(`/api/meetings/${id}/audio`, { method: "PUT", cookie, body: "hi", headers: { "Content-Type": "text/plain" } });
    expect(notAudio.status).toBe(415);
    const big = 1024 * 1024 + 1;
    const tooLarge = await t.fetch(`/api/meetings/${id}/audio`, { method: "PUT", cookie, body: new Uint8Array(big), headers: { "Content-Type": "audio/mp4", "Content-Length": String(big) } });
    expect(tooLarge.status).toBe(413);
  });

  it("keeps meetings private to their owner", async () => {
    t = setup();
    const admin = await t.signIn();
    await t.fetch("/api/users", { method: "POST", cookie: admin, body: JSON.stringify({ email: "ana@example.org" }) });
    const ana = await t.signIn("ana@example.org");
    const id = await t.meetingWithAudio(admin);
    expect((await t.fetch(`/api/meetings/${id}`, { cookie: ana })).status).toBe(404);
    expect((await t.fetch(`/api/meetings/${id}/audio`, { cookie: ana })).status).toBe(404);
    expect((await t.fetch(`/api/meetings/${id}`, { method: "DELETE", cookie: ana })).status).toBe(404);
    const steal = await t.fetch("/api/meetings", { method: "POST", cookie: ana, body: JSON.stringify({ id }) });
    expect(steal.status).toBe(409);
  });

  it("renames, names voices and reassigns blocks without touching the text", async () => {
    t = setup();
    const cookie = await t.signIn();
    await t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider: "deepgram", granted: true }) });
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
    const r = await t.fetch(`/api/meetings/${id}`, { method: "PATCH", cookie, body: JSON.stringify({ title: "Junta de octubre", speakerNames: { 0: "Sara (Directora)" }, speakers: [0, 0] }) });
    expect(r.status).toBe(200);
    const m = await (await t.fetch(`/api/meetings/${id}`, { cookie })).json();
    expect(m.title).toBe("Junta de octubre");
    expect(m.speakerNames).toEqual({ 0: "Sara (Directora)" });
    expect(m.transcript.blocks.map((b: { speaker: number }) => b.speaker)).toEqual([0, 0]);
    expect(m.transcript.blocks[1].text).toBe("Empecemos con la agenda.");
    const bad = await t.fetch(`/api/meetings/${id}`, { method: "PATCH", cookie, body: JSON.stringify({ speakers: [0] }) });
    expect(bad.status).toBe(400);
  });

  it("deletes a meeting with its audio", async () => {
    t = setup();
    const cookie = await t.signIn();
    const id = await t.meetingWithAudio(cookie);
    expect((await t.fetch(`/api/meetings/${id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect(await t.deps.files.get(`audio/${(await t.deps.store.userByEmail("admin@example.org"))!.id}/${id}`)).toBeNull();
  });
});

describe("retention", () => {
  it("deletes meetings, transcripts and audio after 30 days", async () => {
    t = setup();
    const cookie = await t.signIn();
    const id = await t.meetingWithAudio(cookie);
    const { maintenance } = await import("../../src/server/app.ts");
    expect((await maintenance(t.deps)).deleted).toBe(0);
    t.advance(30 * 86_400_000 + 1);
    expect((await maintenance(t.deps)).deleted).toBe(1);
    const user = (await t.deps.store.userByEmail("admin@example.org"))!;
    expect(await t.deps.store.meeting(user.id, id)).toBeNull();
    expect(await t.deps.files.get(`audio/${user.id}/${id}`)).toBeNull();
  });
});

describe("export", () => {
  it("downloads every meeting and transcript as JSON, never the keys", async () => {
    t = setup();
    const cookie = await t.signIn();
    await t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider: "deepgram", granted: true }) });
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-9876" }) });
    const id = await t.meetingWithAudio(cookie);
    await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
    const r = await t.fetch("/api/export", { cookie });
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const text = await r.text();
    const data = JSON.parse(text);
    expect(data.format).toBe("minuteca-export");
    expect(data.meetings[0].transcript.blocks).toHaveLength(2);
    expect(data.meetings[0].audioUrl).toBe(`/api/meetings/${id}/audio`);
    expect(data.account.keys).toEqual([{ provider: "deepgram", last4: "9876" }]);
    expect(text).not.toContain("good-deepgram-key");
    expect(text).not.toContain("ciphertext");
  });
});
