import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/web/lib/api";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a slow answer that starts with spaces", async () => {
    vi.stubGlobal("fetch", async () => new Response('   {"minutes":"ok"}', { status: 200 }));
    await expect(api("/meetings/m/minutes", { method: "POST" })).resolves.toEqual({ minutes: "ok" });
  });

  it("turns a slow error back into an error with its real status", async () => {
    vi.stubGlobal("fetch", async () => new Response('  {"error":"llm_unavailable","errorStatus":502}', { status: 200 }));
    await expect(api("/meetings/m/minutes", { method: "POST" })).rejects.toMatchObject({ code: "llm_unavailable", status: 502 });
    vi.stubGlobal("fetch", async () => new Response('{"error":"no_llm_consent"}', { status: 403 }));
    await expect(api("/x")).rejects.toMatchObject({ code: "no_llm_consent", status: 403 });
  });

  it("shows what the provider said, as status and error type, after the message", async () => {
    vi.stubGlobal("fetch", async () => new Response(' {"error":"llm_rejected","detail":"anthropic 400 invalid_request_error","errorStatus":502}', { status: 200 }));
    const e = await api("/meetings/m/minutes", { method: "POST" }).catch((x) => x);
    expect(e).toMatchObject({ code: "llm_rejected", detail: "anthropic 400 invalid_request_error" });
    expect(e.message).toMatch(/\S.* \(anthropic 400 invalid_request_error\)$/);
    expect(e.message).not.toMatch(/^llm_rejected/);
  });
});
