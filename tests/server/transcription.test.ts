import { afterEach, describe, expect, it } from "vitest";
import { done, fakeTranscriber, setup, transcript } from "./helpers.ts";
import type { HostedKeys } from "../../src/server/transcription.ts";

let t: ReturnType<typeof setup>;
afterEach(() => t?.cleanup());

const consent = (cookie: string, provider = "deepgram") =>
  t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider, granted: true }) });

describe("own provider keys", () => {
  it("checks the key with its provider, stores it encrypted and shows only its last 4 characters", async () => {
    t = setup();
    const cookie = await t.signIn();
    const bad = await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "bad-key-0000000000000" }) });
    expect(bad.status).toBe(400);
    const ok = await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-secret-key-ABCD" }) });
    expect(await ok.json()).toEqual({ provider: "deepgram", last4: "ABCD" });
    const rows = await t.db.all<Record<string, string>>("SELECT * FROM provider_keys");
    expect(JSON.stringify(rows)).not.toContain("good-secret-key");
    const me = await (await t.fetch("/api/me", { cookie })).json();
    expect(JSON.stringify(me)).not.toContain("good-secret-key");
    expect(me.providers.find((p: { id: string }) => p.id === "deepgram").ownKey.last4).toBe("ABCD");
    await t.fetch("/api/keys/deepgram", { method: "DELETE", cookie });
    expect(await t.db.all("SELECT * FROM provider_keys")).toHaveLength(0);
  });

  it("cannot save keys without the server encryption key", async () => {
    t = setup();
    t.deps.vault = null;
    const cookie = await t.signIn();
    const { createApp } = await import("../../src/server/app.ts");
    const app = createApp(t.deps);
    const r = await app.fetch(new Request("http://localhost:8787/api/keys/deepgram", { method: "PUT", headers: { Cookie: cookie, Origin: "http://localhost:8787", "Content-Type": "application/json" }, body: JSON.stringify({ key: "good-secret-key-ABCD" }) }));
    expect(r.status).toBe(503);
  });
});

describe("transcription", () => {
  it("needs the person's permission for the provider first", async () => {
    t = setup();
    const cookie = await t.signIn();
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    const r = await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("no_consent");
    expect(t.tr.deepgram.calls).toHaveLength(0);
  });

  it("needs a key: the person's own or a hosted one", async () => {
    t = setup();
    const cookie = await t.signIn();
    await consent(cookie);
    const id = await t.meetingWithAudio(cookie);
    const r = await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
    expect(r.status).toBe(402);
    expect((await r.json()).error).toBe("no_key");
  });

  it("transcribes with the person's own key and records the minutes", async () => {
    t = setup();
    const cookie = await t.signIn();
    await consent(cookie);
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    const r = await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: JSON.stringify({ language: "es" }) });
    expect((await r.json()).status).toBe("done");
    expect(t.tr.deepgram.calls[0]).toMatchObject({ apiKey: "good-deepgram-key-1234", language: "es", bytes: 4000 });
    const me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me.usage).toMatchObject({ ownSeconds: 120, hostedSeconds: 0 });
    // Done is done: no second charge.
    const again = await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
    expect(again.status).toBe(409);
    expect(t.tr.deepgram.calls).toHaveLength(1);
  });

  it("keeps the audio and frees the minutes when the provider fails, so it can be retried", async () => {
    let fail = true;
    const dg = fakeTranscriber("deepgram", { result: () => (fail ? ({ status: "failed", error: "unprocessable" } as const) : done()) });
    t = setup({ transcribers: { deepgram: dg } });
    const cookie = await t.signIn();
    await consent(cookie);
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    const first = await (await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" })).json();
    expect(first).toMatchObject({ status: "error", error: "unprocessable", hasAudio: true });
    expect((await (await t.fetch("/api/me", { cookie })).json()).usage.ownSeconds).toBe(0);
    fail = false;
    const second = await (await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" })).json();
    expect(second.status).toBe("done");
  });

  it("refuses files larger than the provider accepts", async () => {
    t = setup({ transcribers: { openai: fakeTranscriber("openai", { maxBytes: 100 }) } });
    const cookie = await t.signIn();
    await consent(cookie, "openai");
    await t.fetch("/api/keys/openai", { method: "PUT", cookie, body: JSON.stringify({ key: "good-openai-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    const r = await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: JSON.stringify({ provider: "openai" }) });
    expect(r.status).toBe(413);
  });
});

describe("hosted keys and the monthly cap", () => {
  const hosted = (capSeconds: number): HostedKeys => ({
    key: (p) => (p === "deepgram" ? "hosted-deepgram-key" : undefined),
    allowed: () => true,
    monthlyCapSeconds: capSeconds,
  });

  it("uses the hosted key when the person has none, and stops at the cap", async () => {
    t = setup({ hosted: hosted(200) });
    const cookie = await t.signIn();
    await consent(cookie);
    const one = await t.meetingWithAudio(cookie);
    expect((await (await t.fetch(`/api/meetings/${one}/transcribe`, { method: "POST", cookie, body: "{}" })).json()).status).toBe("done");
    expect(t.tr.deepgram.calls[0]!.apiKey).toBe("hosted-deepgram-key");
    const me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me.hosted).toEqual({ remainingSeconds: 80, capSeconds: 200 });
    expect(me.usage.hostedSeconds).toBe(120);

    const two = await t.meetingWithAudio(cookie);
    const r = await t.fetch(`/api/meetings/${two}/transcribe`, { method: "POST", cookie, body: "{}" });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("hosted_cap");
    expect(t.tr.deepgram.calls).toHaveLength(1);
  });

  it("prefers the person's own key, which has no cap of ours", async () => {
    t = setup({ hosted: hosted(0) });
    const cookie = await t.signIn();
    await consent(cookie);
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    expect((await (await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" })).json()).status).toBe("done");
    expect(t.tr.deepgram.calls[0]!.apiKey).toBe("good-deepgram-key-1234");
  });

  it("starts again each month", async () => {
    t = setup({ hosted: hosted(150) });
    const cookie = await t.signIn();
    await consent(cookie);
    await t.fetch(`/api/meetings/${await t.meetingWithAudio(cookie)}/transcribe`, { method: "POST", cookie, body: "{}" });
    t.advance(25 * 86_400_000); // December
    const r = await t.fetch(`/api/meetings/${await t.meetingWithAudio(cookie)}/transcribe`, { method: "POST", cookie, body: "{}" });
    expect((await r.json()).status).toBe("done");
  });
});

describe("providers that answer later", () => {
  it("lets the provider download the audio once through a private link and post the result", async () => {
    const dg = fakeTranscriber("deepgram", { result: () => ({ status: "pending", providerJobId: "dg-1" }), callback: true });
    t = setup({ env: { MINUTECA_ORIGIN: "https://minuteca.example.org" }, transcribers: { deepgram: dg } });
    const cookie = await t.signIn();
    expect(cookie).toMatch(/^__Host-minuteca=/);
    await consent(cookie);
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    const started = await (await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" })).json();
    expect(started.status).toBe("transcribing");
    const { url, callbackUrl } = dg.calls[0]!;
    expect(url).toMatch(/^https:\/\/minuteca\.example\.org\/api\/provider-audio\//);
    const path = (u: string) => new URL(u).pathname;

    const wrong = path(url!).replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect((await t.fetch(wrong)).status).toBe(404);
    const audio = await t.fetch(path(url!));
    expect((await audio.arrayBuffer()).byteLength).toBe(4000);

    const done = await t.fetch(path(callbackUrl!), { method: "POST", body: JSON.stringify(transcript()), headers: { Origin: "https://api.deepgram.com" } });
    expect(done.status).toBe(200);
    const m = await (await t.fetch(`/api/meetings/${id}`, { cookie })).json();
    expect(m.status).toBe("done");
    // The link dies with the job.
    expect((await t.fetch(path(url!))).status).toBe(404);
  });

  it("polls asynchronous providers and deletes the job from them afterwards", async () => {
    let ready = false;
    const aai = fakeTranscriber("assemblyai", {
      result: () => ({ status: "pending", providerJobId: "aai-1" }),
      poll: () => (ready ? done(transcript("assemblyai"), "aai-1") : { status: "pending", providerJobId: "aai-1" }),
    });
    t = setup({ transcribers: { assemblyai: aai } });
    const cookie = await t.signIn();
    await consent(cookie, "assemblyai");
    await t.fetch("/api/keys/assemblyai", { method: "PUT", cookie, body: JSON.stringify({ key: "good-assembly-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: JSON.stringify({ provider: "assemblyai" }) });
    expect((await (await t.fetch(`/api/meetings/${id}`, { cookie })).json()).status).toBe("transcribing");
    ready = true;
    const m = await (await t.fetch(`/api/meetings/${id}`, { cookie })).json();
    expect(m.status).toBe("done");
    expect(m.transcript.provider).toBe("assemblyai");
    expect(aai.forgotten).toEqual(["aai-1"]);
  });

  it("marks a job that never answers as failed so it can be retried", async () => {
    const aai = fakeTranscriber("assemblyai", { result: () => ({ status: "pending", providerJobId: "aai-2" }), poll: () => ({ status: "pending", providerJobId: "aai-2" }) });
    t = setup({ transcribers: { assemblyai: aai } });
    const cookie = await t.signIn();
    await consent(cookie, "assemblyai");
    await t.fetch("/api/keys/assemblyai", { method: "PUT", cookie, body: JSON.stringify({ key: "good-assembly-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: JSON.stringify({ provider: "assemblyai" }) });
    t.advance(61 * 60_000);
    const { maintenance } = await import("../../src/server/app.ts");
    await maintenance(t.deps);
    const m = await (await t.fetch(`/api/meetings/${id}`, { cookie })).json();
    expect(m).toMatchObject({ status: "error", error: "timeout" });
  });
});

describe("conversion in the browser (hosts with little CPU per request)", () => {
  it("keeps the provider's answer as is until the browser sends the transcript", async () => {
    const dg = fakeTranscriber("deepgram", { result: () => ({ status: "pending", providerJobId: "dg-9" }), callback: true });
    t = setup({ env: { MINUTECA_ORIGIN: "https://minuteca.example.org", MINUTECA_CONVERT: "client" }, transcribers: { deepgram: dg } });
    const cookie = await t.signIn();
    await consent(cookie);
    await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
    const id = await t.meetingWithAudio(cookie);
    await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
    const cb = new URL(dg.calls[0]!.callbackUrl!).pathname;
    const answer = JSON.stringify(transcript("deepgram", 90));
    expect((await t.fetch(cb, { method: "POST", body: answer, headers: { Origin: "https://api.deepgram.com" } })).status).toBe(200);

    expect((await (await t.fetch(`/api/meetings/${id}`, { cookie })).json()).status).toBe("converting");
    const raw = await t.fetch(`/api/meetings/${id}/raw`, { cookie });
    expect(await raw.text()).toBe(answer);

    const wrong = await t.fetch(`/api/meetings/${id}/transcript`, { method: "PUT", cookie, body: JSON.stringify({ transcript: { ...transcript("openai") } }) });
    expect(wrong.status).toBe(400);
    const ok = await t.fetch(`/api/meetings/${id}/transcript`, { method: "PUT", cookie, body: JSON.stringify({ transcript: transcript("deepgram", 90) }) });
    expect((await ok.json()).status).toBe("done");
    // Minutes are never lowered by what the browser reports: the booked 120 s stay.
    expect((await (await t.fetch("/api/me", { cookie })).json()).usage.ownSeconds).toBe(120);
    expect((await t.fetch(`/api/meetings/${id}/raw`, { cookie })).status).toBe(404);
  });
});
