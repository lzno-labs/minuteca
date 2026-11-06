import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../../src/server/llm/anthropic.ts";
import { gemini } from "../../src/server/llm/gemini.ts";
import { LlmError } from "../../src/server/llm/llm.ts";
import { localChat, openaiChat, openrouter } from "../../src/server/llm/openai-chat.ts";
import { firstJsonObject, parseSuggestions, transcriptLines } from "../../src/server/minutes.ts";
import { transcript } from "./helpers.ts";

const req = { system: "sys", prompt: "hola", maxTokens: 100 };

/** Just enough of the Anthropic client for the adapter. */
function fakeClaude(message: Record<string, unknown>, sent: unknown[] = []) {
  return (() => ({
    beta: { messages: { stream: (p: unknown) => (sent.push(p), { finalMessage: async () => message }) } },
    models: { list: async () => ({ data: [] }) },
  })) as unknown as (k: string) => Anthropic;
}

describe("Claude adapter", () => {
  it("streams with effort and refusal fallbacks, and joins the text blocks", async () => {
    const sent: any[] = [];
    const a = anthropic(fakeClaude({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hola " }, { type: "text", text: "mundo" }], usage: { input_tokens: 10, output_tokens: 5 } }, sent));
    expect(a.defaultModel).toBe("claude-opus-5-5");
    const r = await a.complete({ ...req, effort: "low" }, { apiKey: "k", model: "claude-opus-5-5" });
    expect(r).toEqual({ text: "Hola mundo", model: "claude-opus-5-5", inputTokens: 10, outputTokens: 5 });
    expect(sent[0]).toMatchObject({ model: "claude-opus-5-5", system: "sys", output_config: { effort: "low" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });

  it("reports a refusal instead of an empty answer", async () => {
    const a = anthropic(fakeClaude({ model: "m", stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } }));
    await expect(a.complete(req, { apiKey: "k", model: "m" })).rejects.toMatchObject({ code: "refused" });
  });
});

describe("chat completions adapters", () => {
  it("send the system and user messages and read the answer and tokens", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ model: "gpt-x", choices: [{ message: { content: " Minuta " }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
    }) as typeof fetch;
    const r = await openaiChat(fetcher).complete({ ...req, json: true }, { apiKey: "sk", model: "gpt-x" });
    expect(r).toEqual({ text: "Minuta", model: "gpt-x", inputTokens: 7, outputTokens: 3 });
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hola" }]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk");

    await openrouter(fetcher).complete(req, { apiKey: "or", model: "openrouter/auto" });
    expect(seen[1]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    await localChat("http://localhost:11434/v1/", "llama3.1", fetcher).complete(req, { apiKey: "", model: "llama3.1" });
    expect(seen[2]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect((seen[2]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("turn status codes into codes the app can explain", async () => {
    const status = (s: number) => (async () => new Response("secret details", { status: s })) as unknown as typeof fetch;
    await expect(openaiChat(status(401)).complete(req, { apiKey: "k", model: "m" })).rejects.toMatchObject({ code: "invalid_key" });
    await expect(openaiChat(status(404)).complete(req, { apiKey: "k", model: "m" })).rejects.toMatchObject({ code: "model_not_found" });
    const e = await openaiChat(status(500)).complete(req, { apiKey: "k", model: "m" }).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.message).not.toContain("secret");
  });
});

describe("Gemini adapter", () => {
  it("uses the key header, the system instruction and reads the parts", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ modelVersion: "gemini-x", candidates: [{ content: { parts: [{ text: "A" }, { text: "B" }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }));
    }) as typeof fetch;
    const r = await gemini(fetcher).complete({ ...req, json: true }, { apiKey: "g", model: "gemini-flash-latest" });
    expect(r).toEqual({ text: "AB", model: "gemini-x", inputTokens: 4, outputTokens: 2 });
    expect(seen!.url).toContain("/models/gemini-flash-latest:generateContent");
    expect(seen!.url).not.toContain("key=");
    expect((seen!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("knows an invalid key behind Gemini's 400", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API key not valid." } }), { status: 400 })) as unknown as typeof fetch;
    await expect(gemini(fetcher).complete(req, { apiKey: "g", model: "m" })).rejects.toMatchObject({ code: "invalid_key" });
  });
});

describe("prompt helpers", () => {
  it("merge consecutive blocks of a voice into one line with its time", () => {
    const tr = transcript();
    tr.blocks.push({ speaker: 1, start: 9.5, end: 12, text: "Primer punto." });
    expect(transcriptLines(tr, (s) => `S${s}`)).toBe("[00:00] S0: Buenos días a todos.\n[00:04] S1: Empecemos con la agenda. Primer punto.");
  });

  it("find the JSON in an answer and keep valid suggestions only", () => {
    expect(firstJsonObject('```json\n{"speakers": []}\n```')).toEqual({ speakers: [] });
    expect(firstJsonObject("sin json")).toBeNull();
    const ok = parseSuggestions({ speakers: [{ speaker: 1, name: " Marco ", evidence: "x" }, { speaker: 1, name: "Otro" }, { speaker: "2", name: "Ana" }, { speaker: 9, name: "Z" }] }, new Set([0, 1, 2]));
    expect(ok).toEqual([{ speaker: 1, name: "Marco", evidence: "x" }, { speaker: 2, name: "Ana", evidence: "" }]);
  });
});
