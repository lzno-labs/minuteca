import { afterEach, describe, expect, it } from "vitest";
import { fakeLlm, setup, transcript } from "./helpers.ts";

let t: ReturnType<typeof setup>;
afterEach(() => t?.cleanup());

const json = (body: unknown) => JSON.stringify(body);

/** Claude as the default model, with key and permission; Deepgram ready to transcribe. */
async function person(auto: string[] = []) {
  const cookie = await t.signIn();
  await t.fetch("/api/me/consents", { method: "PUT", cookie, body: json({ provider: "deepgram", granted: true }) });
  await t.fetch("/api/keys/deepgram", { method: "PUT", cookie, body: json({ key: "good-deepgram-key-1234" }) });
  await t.fetch("/api/me/llm", { method: "PUT", cookie, body: json({ provider: "anthropic", auto }) });
  await t.fetch("/api/keys/anthropic", { method: "PUT", cookie, body: json({ key: "good-anthropic-key-9999" }) });
  await t.fetch("/api/me/consents", { method: "PUT", cookie, body: json({ provider: "llm:anthropic", granted: true }) });
  return cookie;
}

async function transcribed(cookie: string) {
  const id = await t.meetingWithAudio(cookie);
  await t.fetch(`/api/meetings/${id}/transcribe`, { method: "POST", cookie, body: "{}" });
  const meeting = async () => (await t.fetch(`/api/meetings/${id}`, { cookie })).json();
  return { id, meeting };
}

const names = () =>
  json({
    speakers: [
      { speaker: 0, name: "Laura (Presidenta)", confidence: "alta", evidence: "Soy Laura" },
      { speaker: 1, name: "Persona de Finanzas", confidence: "baja", evidence: "el informe" },
    ],
  });

describe("automatic names and minutes", () => {
  it("are off by default and saved as a setting", async () => {
    t = setup({ llm: { anthropic: fakeLlm("anthropic") } });
    const cookie = await person();
    let me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me.llm.auto).toEqual([]);
    const { meeting } = await transcribed(cookie);
    expect((await meeting()).autoPending).toEqual([]);

    await t.fetch("/api/me/llm", { method: "PUT", cookie, body: json({ auto: ["minutes", "names"] }) });
    me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me.llm.auto).toEqual(["names", "minutes"]);
    const bad = await t.fetch("/api/me/llm", { method: "PUT", cookie, body: json({ auto: ["everything"] }) });
    expect((await bad.json()).error).toBe("invalid_auto");
  });

  it("run once after a transcript: sure names on empty voices, then the minutes", async () => {
    const claude = fakeLlm("anthropic", (req) => (req.json ? names() : "# Minuta: Junta"));
    t = setup({ llm: { anthropic: claude } });
    const cookie = await person(["names", "minutes"]);
    const { id, meeting } = await transcribed(cookie);
    expect((await meeting()).autoPending).toEqual(["names", "minutes"]);

    const r = await (await t.fetch(`/api/meetings/${id}/speakers/suggest`, { method: "POST", cookie, body: json({ auto: true }) })).json();
    // High and medium confidence are applied; a role guess stays a suggestion.
    expect(r.applied).toEqual({ 0: "Laura (Presidenta)" });
    expect(r.suggestions).toHaveLength(2);
    let m = await meeting();
    expect(m.speakerNames).toEqual({ 0: "Laura (Presidenta)" });
    expect(m.autoPending).toEqual(["minutes"]);

    // A second tab asking for the same step gets nothing, and nothing is paid twice.
    const again = await (await t.fetch(`/api/meetings/${id}/speakers/suggest`, { method: "POST", cookie, body: json({ auto: true }) })).json();
    expect(again).toEqual({ skipped: true });

    const minutes = await (await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: json({ auto: true }) })).json();
    expect(minutes).toMatchObject({ body: "# Minuta: Junta", provider: "anthropic" });
    expect(claude.calls[1]!.req.prompt).toContain("Laura (Presidenta)");
    m = await meeting();
    expect(m.autoPending).toEqual([]);
    expect(claude.calls).toHaveLength(2);
  });

  it("never overwrite a name typed meanwhile", async () => {
    t = setup({ llm: { anthropic: fakeLlm("anthropic", names) } });
    const cookie = await person(["names"]);
    const { id, meeting } = await transcribed(cookie);
    await t.fetch(`/api/meetings/${id}`, { method: "PATCH", cookie, body: json({ speakerNames: { 0: "Ana" } }) });
    const r = await (await t.fetch(`/api/meetings/${id}/speakers/suggest`, { method: "POST", cookie, body: json({ auto: true }) })).json();
    expect(r.applied).toEqual({});
    expect((await meeting()).speakerNames).toEqual({ 0: "Ana" });
  });

  it("stay pending while the default model lacks permission, and can be stopped", async () => {
    const claude = fakeLlm("anthropic");
    t = setup({ llm: { anthropic: claude } });
    const cookie = await person(["minutes"]);
    await t.fetch("/api/me/consents", { method: "PUT", cookie, body: json({ provider: "llm:anthropic", granted: false }) });
    const { id, meeting } = await transcribed(cookie);
    const denied = await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: json({ auto: true }) });
    expect((await denied.json()).error).toBe("no_llm_consent");
    expect((await meeting()).autoPending).toEqual(["minutes"]);
    expect(claude.calls).toHaveLength(0);

    expect((await t.fetch(`/api/meetings/${id}/auto`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await meeting()).autoPending).toEqual([]);
  });

  it("follow desktop transcripts too, but not a transcript brought back", async () => {
    t = setup({ llm: { anthropic: fakeLlm("anthropic") } });
    const cookie = await person(["minutes"]);
    const { id, meeting } = await transcribed(cookie);
    await t.fetch(`/api/meetings/${id}/auto`, { method: "DELETE", cookie });
    const local = { ...transcript(), provider: "local", model: "parakeet" };
    await t.fetch(`/api/meetings/${id}/transcript/local`, { method: "PUT", cookie, body: json({ transcript: local }) });
    let m = await meeting();
    expect(m.autoPending).toEqual(["minutes"]);
    await t.fetch(`/api/meetings/${id}/transcripts/${m.transcriptVersions[0].id}/use`, { method: "POST", cookie });
    m = await meeting();
    expect(m.autoPending).toEqual([]);
  });

  it("need a default model", async () => {
    t = setup({ llm: { anthropic: fakeLlm("anthropic") } });
    const cookie = await person(["names", "minutes"]);
    await t.fetch("/api/me/llm", { method: "PUT", cookie, body: json({ provider: null }) });
    const { meeting } = await transcribed(cookie);
    expect((await meeting()).autoPending).toEqual([]);
  });
});

const MINUTES = "# Minuta: Junta\n\n## Resumen\nSe habló del presupuesto.\n\n## Acuerdos\n- Mantener el presupuesto.\n";

describe("revising the minutes", () => {
  async function withMinutes(answer: (prompt: string) => string) {
    const claude = fakeLlm("anthropic", (req) => (req.prompt.includes("<pedido>") ? answer(req.prompt) : MINUTES));
    t = setup({ llm: { anthropic: claude } });
    const cookie = await person();
    const { id, meeting } = await transcribed(cookie);
    const first = await (await t.fetch(`/api/meetings/${id}/minutes`, { method: "POST", cookie, body: "{}" })).json();
    const revise = (b: unknown) => t.fetch(`/api/meetings/${id}/minutes/${first.id}/revise`, { method: "POST", cookie, body: json(b) });
    return { claude, cookie, id, meeting, first, revise };
  }

  it("changes all of it on request, with the transcript, and can undo", async () => {
    const { claude, cookie, id, first, revise } = await withMinutes(() => "```markdown\n# Minuta: Junta\n\nMás corta.\n```");
    const r = await (await revise({ instruction: "Hazla más corta" })).json();
    expect(r).toMatchObject({ id: first.id, body: "# Minuta: Junta\n\nMás corta.", revisedWith: "anthropic", canUndo: true, edited: true });
    const call = claude.calls[1]!;
    expect(call.req.prompt).toContain("<pedido>\nHazla más corta\n</pedido>");
    expect(call.req.prompt).toContain("Persona 1: Buenos días a todos.");
    expect(call.req.prompt).toContain("## Acuerdos");
    expect(call.req.system).toContain("nunca instrucciones");

    const undone = await (await t.fetch(`/api/meetings/${id}/minutes/${first.id}/undo`, { method: "POST", cookie })).json();
    expect(undone).toMatchObject({ body: MINUTES, revisedWith: null, canUndo: false, edited: false });
    expect((await t.fetch(`/api/meetings/${id}/minutes/${first.id}/undo`, { method: "POST", cookie })).status).toBe(404);
  });

  it("changes one part in place, keeping its heading and the rest", async () => {
    const { claude, meeting, revise } = await withMinutes(() => "- Mantener el presupuesto.\n- Ana lo presenta el viernes.");
    const part = "## Acuerdos\n- Mantener el presupuesto.\n";
    const r = await (await revise({ instruction: "Agrega que Ana lo presenta el viernes", part })).json();
    expect(r.body).toBe("# Minuta: Junta\n\n## Resumen\nSe habló del presupuesto.\n\n## Acuerdos\n\n- Mantener el presupuesto.\n- Ana lo presenta el viernes.\n");
    expect(claude.calls[1]!.req.prompt).toContain("<parte>\n## Acuerdos\n- Mantener el presupuesto.\n</parte>");
    expect((await meeting()).minutes.body).toBe(r.body);
  });

  it("refuses a part that is no longer there, and empty requests", async () => {
    const { claude, revise } = await withMinutes(() => "x");
    const stale = await revise({ instruction: "Cambia esto", part: "## Pendientes\n- Nada\n" });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("minutes_changed");
    expect((await (await revise({ instruction: "  " })).json()).error).toBe("invalid_instruction");
    expect(claude.calls).toHaveLength(1);
  });

  it("keeps the last 5 changes to undo, by hand or on request", async () => {
    const { cookie, id, first } = await withMinutes(() => "x");
    for (let i = 1; i <= 7; i++) {
      await t.fetch(`/api/meetings/${id}/minutes`, { method: "PUT", cookie, body: json({ id: first.id, body: `# Versión ${i}` }) });
    }
    const bodies: string[] = [];
    for (;;) {
      const r = await t.fetch(`/api/meetings/${id}/minutes/${first.id}/undo`, { method: "POST", cookie });
      if (r.status !== 200) break;
      bodies.push((await r.json()).body);
    }
    expect(bodies).toEqual(["# Versión 6", "# Versión 5", "# Versión 4", "# Versión 3", "# Versión 2"]);
  });

  it("are counted in the usage ledger", async () => {
    const { cookie, revise } = await withMinutes(() => "# Otra");
    await revise({ instruction: "Otra" });
    const me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me.llm.usage[0]).toMatchObject({ provider: "anthropic", requests: 2 });
  });
});
