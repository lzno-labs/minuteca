import { afterEach, describe, expect, it } from "vitest";
import { fakeLlm, setup } from "./helpers.ts";

let t: ReturnType<typeof setup>;
afterEach(() => t?.cleanup());

/** A signed-in person with a transcribed meeting (fake Deepgram, own key). */
async function transcribedMeeting() {
  const cookie = await t.signIn();
  await t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider: "deepgram", granted: true }) });
  await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: JSON.stringify({ key: "good-deepgram-key-1234" }) });
  const id = await t.meetingWithAudio(cookie);
  await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
  return { cookie, id };
}

const useClaude = async (cookie: string, consent = true) => {
  await t.fetch("/api/me/llm", { method: "PUT", cookie, body: JSON.stringify({ provider: "anthropic" }) });
  await t.fetch("/api/keys/anthropic", { method: "PUT", cookie, body: JSON.stringify({ key: "good-anthropic-key-9999" }) });
  if (consent) await t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider: "llm:anthropic", granted: true }) });
};

describe("language model settings", () => {
  it("lists the providers with the person's key status and model, never the key", async () => {
    t = setup();
    const cookie = await t.signIn();
    await useClaude(cookie);
    await t.fetch("/api/me/llm", { method: "PUT", cookie, body: JSON.stringify({ models: { anthropic: "claude-sonnet-5-5" }, instructions: "Formato de acta de junta directiva." }) });
    const me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me.llm.provider).toBe("anthropic");
    expect(me.llm.instructions).toBe("Formato de acta de junta directiva.");
    const claude = me.llm.providers.find((p: { id: string }) => p.id === "anthropic");
    expect(claude).toMatchObject({ ownKey: { last4: "9999" }, model: "claude-sonnet-5-5", defaultModel: "anthropic-default", needsKey: true });
    expect(me.consents).toContain("llm:anthropic");
    expect(JSON.stringify(me)).not.toContain("good-anthropic-key");
    // Providers this server does not offer cannot be chosen; model names are checked.
    expect((await t.fetch("/api/me/llm", { method: "PUT", cookie, body: JSON.stringify({ provider: "local" }) })).status).toBe(400);
    expect((await t.fetch("/api/me/llm", { method: "PUT", cookie, body: JSON.stringify({ models: { anthropic: "bad model!" } }) })).status).toBe(400);
  });

  it("checks a language model key with its own provider", async () => {
    t = setup();
    const cookie = await t.signIn();
    expect((await t.fetch("/api/keys/gemini", { method: "PUT", cookie, body: JSON.stringify({ key: "bad-gemini-key-000000" }) })).status).toBe(400);
    expect((await t.fetch("/api/keys/gemini", { method: "PUT", cookie, body: JSON.stringify({ key: "good-gemini-key-000000" }) })).status).toBe(200);
  });
});

describe("speaker name suggestions", () => {
  it("need permission to send the transcript, and suggest only real voices", async () => {
    const claude = fakeLlm("anthropic", () => 'Aquí está:\n{"speakers": [{"speaker": 0, "name": "Laura (Presidenta)", "evidence": "Gracias, Laura"}, {"speaker": 7, "name": "Nadie"}, {"speaker": 1, "name": ""}]}');
    t = setup({ llm: { anthropic: claude } });
    const { cookie, id } = await transcribedMeeting();
    await useClaude(cookie, false);
    const denied = await t.fetch(`/api/meetings/${id}/speakers/suggest`, { method: "POST", cookie, body: "{}" });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe("no_llm_consent");
    expect(claude.calls).toHaveLength(0);

    await t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider: "llm:anthropic", granted: true }) });
    const r = await (await t.fetch(`/api/meetings/${id}/speakers/suggest`, { method: "POST", cookie, body: "{}" })).json();
    expect(r.suggestions).toEqual([{ speaker: 0, name: "Laura (Presidenta)", evidence: "Gracias, Laura" }]);
    expect(claude.calls[0]!.apiKey).toBe("good-anthropic-key-9999");
    expect(claude.calls[0]!.req.json).toBe(true);
    expect(claude.calls[0]!.req.prompt).toContain("S0: Buenos días a todos.");
    // Suggestions are not saved: the person chooses.
    expect((await (await t.fetch(`/api/meetings/${id}`, { cookie })).json()).speakerNames).toEqual({});
  });
});

describe("minutes", () => {
  it("are written from the transcript with the names, saved, edited and exported", async () => {
    const claude = fakeLlm("anthropic");
    t = setup({ llm: { anthropic: claude } });
    const { cookie, id } = await transcribedMeeting();
    await useClaude(cookie);
    await t.fetch(`/api/meetings/${id}`, { method: "PATCH", cookie, body: JSON.stringify({ speakerNames: { 0: "Laura (Presidenta)" } }) });
    await t.fetch("/api/me/llm", { method: "PUT", cookie, body: JSON.stringify({ instructions: "Usa el formato de acta." }) });

    const made = await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: "{}" });
    expect(made.status).toBe(200);
    expect(await made.json()).toMatchObject({ body: expect.stringContaining("# Minuta"), provider: "anthropic", model: "anthropic-default", edited: false });
    const sent = claude.calls[0]!.req;
    expect(sent.prompt).toContain("Laura (Presidenta): Buenos días a todos.");
    expect(sent.prompt).toContain("Persona 2: Empecemos con la agenda.");
    expect(sent.prompt).toContain("Usa el formato de acta.");
    expect(sent.prompt).toContain("<transcripcion>");

    const edited = await t.fetch(`/api/meetings/${id}/minutes`, { method: "PUT", cookie, body: JSON.stringify({ body: "# Minuta corregida" }) });
    expect(await edited.json()).toMatchObject({ body: "# Minuta corregida", edited: true });
    const m = await (await t.fetch(`/api/meetings/${id}`, { cookie })).json();
    expect(m.minutes.body).toBe("# Minuta corregida");
    const data = await (await t.fetch("/api/export", { cookie })).json();
    expect(data.meetings[0].minutes.body).toBe("# Minuta corregida");
    expect(data.languageModelUsage[0]).toMatchObject({ provider: "anthropic", requests: 1, input_tokens: 1200, output_tokens: 300 });
    const me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me.llm.usage[0]).toMatchObject({ provider: "anthropic", requests: 1 });

    await t.fetch(`/api/meetings/${id}/minutes`, { method: "DELETE", cookie });
    expect((await (await t.fetch(`/api/meetings/${id}`, { cookie })).json()).minutes).toBeNull();
  });

  it("explain what is missing before anything is sent", async () => {
    t = setup();
    const { cookie, id } = await transcribedMeeting();
    const noLlm = await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: "{}" });
    expect((await noLlm.json()).error).toBe("no_llm");
    await t.fetch("/api/me/llm", { method: "PUT", cookie, body: JSON.stringify({ provider: "gemini" }) });
    await t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider: "llm:gemini", granted: true }) });
    const noKey = await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: "{}" });
    expect(noKey.status).toBe(402);
    const fresh = await t.meetingWithAudio(cookie);
    const notYet = await t.fetch(`/api/meetings/${fresh}/minutes`, { method: "POST", cookie, body: "{}" });
    expect((await notYet.json()).error).toBe("not_transcribed");
  });

  it("can use a local model set up by the administrator, with no key", async () => {
    const local = fakeLlm("local", undefined, false);
    t = setup({ llm: { local } });
    const { cookie, id } = await transcribedMeeting();
    await t.fetch("/api/me/llm", { method: "PUT", cookie, body: JSON.stringify({ provider: "local" }) });
    await t.fetch("/api/me/consents", { method: "PUT", cookie, body: JSON.stringify({ provider: "llm:local", granted: true }) });
    expect((await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: "{}" })).status).toBe(200);
    expect(local.calls[0]!.apiKey).toBe("");
  });

  it("are deleted with the meeting", async () => {
    t = setup();
    const { cookie, id } = await transcribedMeeting();
    await useClaude(cookie);
    await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: "{}" });
    await t.fetch(`/api/meetings/${id}`, { method: "DELETE", cookie });
    expect(await t.db.all("SELECT * FROM minutes")).toHaveLength(0);
  });
});
