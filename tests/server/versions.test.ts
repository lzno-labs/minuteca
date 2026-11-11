import { afterEach, describe, expect, it } from "vitest";
import { fakeTranscriber, setup, transcript } from "./helpers.ts";

let t: ReturnType<typeof setup>;
afterEach(() => t?.cleanup());

const json = (body: unknown) => JSON.stringify(body);

/** A meeting transcribed with Deepgram, voice 0 named Ana, and an AssemblyAI key ready. */
async function namedMeeting() {
  const cookie = await t.signIn();
  for (const p of ["deepgram", "assemblyai"]) {
    await t.fetch("/api/me/consents", { method: "PUT", cookie, body: json({ provider: p, granted: true }) });
    await t.fetch(`/api/keys/${p}`, { method: "PUT", cookie, body: json({ key: `good-${p}-key-1234` }) });
  }
  const id = await t.meetingWithAudio(cookie);
  await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: json({ provider: "deepgram" }) });
  await t.fetch(`/api/meetings/${id}`, { method: "PATCH", cookie, body: json({ speakerNames: { 0: "Ana" } }) });
  const meeting = async () => (await t.fetch(`/api/meetings/${id}`, { cookie })).json();
  return { cookie, id, meeting };
}

describe("transcribing a meeting again", () => {
  it("keeps the earlier transcript with its names, and can switch back", async () => {
    t = setup();
    const { cookie, id, meeting } = await namedMeeting();
    const refused = await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: json({ provider: "assemblyai" }) });
    expect((await refused.json()).error).toBe("already_done");

    const again = await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: json({ provider: "assemblyai", again: true }) });
    expect(again.status).toBe(200);
    let m = await meeting();
    expect(m).toMatchObject({ status: "done", provider: "assemblyai", speakerNames: {} });
    expect(m.transcript.provider).toBe("assemblyai");
    expect(m.transcriptVersions).toEqual([expect.objectContaining({ provider: "deepgram", speakerNames: { 0: "Ana" } })]);
    expect(m.transcriptVersions[0].body).toBeUndefined();

    const use = await t.fetch(`/api/meetings/${id}/transcripts/${m.transcriptVersions[0].id}/use`, { method: "POST", cookie });
    expect(use.status).toBe(200);
    m = await meeting();
    expect(m).toMatchObject({ provider: "deepgram", speakerNames: { 0: "Ana" } });
    expect(m.transcript.provider).toBe("deepgram");
    expect(m.transcriptVersions.map((v: { provider: string }) => v.provider)).toEqual(["assemblyai"]);

    const data = await (await t.fetch("/api/export", { cookie })).json();
    expect(data.meetings[0].earlierTranscripts.map((x: { provider: string }) => x.provider)).toEqual(["assemblyai"]);

    expect((await t.fetch(`/api/meetings/${id}/transcripts/${m.transcriptVersions[0].id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await meeting()).transcriptVersions).toEqual([]);
    expect((await t.fetch(`/api/meetings/${id}/transcripts/999/use`, { method: "POST", cookie })).status).toBe(404);
  });

  it("keeps the current transcript when the new one fails", async () => {
    t = setup({ transcribers: { assemblyai: fakeTranscriber("assemblyai", { result: () => ({ status: "failed", error: "unprocessable" }) }) } });
    const { cookie, id, meeting } = await namedMeeting();
    await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: json({ provider: "assemblyai", again: true }) });
    const m = await meeting();
    expect(m).toMatchObject({ status: "done", provider: "deepgram", error: "unprocessable", speakerNames: { 0: "Ana" } });
    expect(m.transcript.provider).toBe("deepgram");
    expect(m.transcriptVersions).toEqual([]);
  });

  it("keeps earlier transcripts when the desktop app transcribes, up to five", async () => {
    t = setup();
    const { cookie, id, meeting } = await namedMeeting();
    const local = { ...transcript(), provider: "local", model: "parakeet" };
    for (let i = 0; i < 7; i++) {
      const r = await t.fetch(`/api/meetings/${id}/transcript/local`, { method: "PUT", cookie, body: json({ transcript: local }) });
      expect(r.status).toBe(200);
      t.advance(1000);
    }
    const m = await meeting();
    expect(m.provider).toBe("local");
    expect(m.transcriptVersions).toHaveLength(5);
    // The oldest ones went first: Deepgram's transcript is no longer kept.
    expect(m.transcriptVersions.every((v: { provider: string }) => v.provider === "local")).toBe(true);
  });
});
