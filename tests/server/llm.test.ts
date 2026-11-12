import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../../src/server/llm/anthropic.ts";
import { gemini, GEMINI_FALLBACKS, thinkingLevel } from "../../src/server/llm/gemini.ts";
import { llmCall, LlmError } from "../../src/server/llm/llm.ts";
import { localChat, openaiChat, openrouter } from "../../src/server/llm/openai-chat.ts";
import { contentLanguage, firstJsonObject, parseSuggestions, transcriptLines } from "../../src/server/minutes.ts";
import { keepAlive } from "../../src/server/app.ts";
import { transcript } from "./helpers.ts";

const req = { system: "sys", prompt: "hola", maxTokens: 100 };

/** Just enough of the Anthropic client for the adapter; `answers` can throw, one per request in order. */
function fakeClaude(message: Record<string, unknown>, sent: unknown[] = [], answers: (Error | null)[] = []) {
  return (() => ({
    beta: {
      messages: {
        stream: (p: unknown) => {
          sent.push(p);
          const answer = answers.shift();
          return { finalMessage: async () => (answer ? Promise.reject(answer) : message) };
        },
      },
    },
    models: { list: async () => ({ data: [] }) },
  })) as unknown as (k: string) => Anthropic;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ErrorClass = new (status: any, error: object, message: undefined, headers: Headers) => Error;
const apiError = (Kind: ErrorClass, status: number, type: string, message = "details from Anthropic") =>
  new Kind(status, { type: "error", error: { type, message } }, undefined, new Headers());

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

  it("asks once more without effort and fallbacks when a model rejects them", async () => {
    const sent: any[] = [];
    const ok = { model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Hola" }], usage: { input_tokens: 3, output_tokens: 1 } };
    const a = anthropic(fakeClaude(ok, sent, [apiError(Anthropic.BadRequestError, 400, "invalid_request_error")]));
    const r = await a.complete({ ...req, effort: "low" }, { apiKey: "k", model: "claude-haiku-5-5" });
    expect(r.text).toBe("Hola");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ model: "claude-haiku-5-5", max_tokens: 100, system: "sys", messages: [{ role: "user", content: "hola" }] });
  });

  it("says what failed: status and error type, never Anthropic's text", async () => {
    const fail = (...errors: Error[]) => anthropic(fakeClaude({}, [], errors)).complete(req, { apiKey: "k", model: "m" }).catch((e) => e);
    const twice = await fail(apiError(Anthropic.BadRequestError, 400, "invalid_request_error"), apiError(Anthropic.BadRequestError, 400, "invalid_request_error"));
    expect(twice).toMatchObject({ code: "rejected", message: "anthropic 400 invalid_request_error" });
    expect(await fail(apiError(Anthropic.InternalServerError, 529, "overloaded_error"))).toMatchObject({ code: "overloaded", message: "anthropic 529 overloaded_error" });
    expect(await fail(apiError(Anthropic.BadRequestError, 400, "invalid_request_error", "prompt is too long: 1200000 tokens > 1000000 maximum"))).toMatchObject({ code: "too_long" });
    expect(await fail(apiError(Anthropic.AuthenticationError, 401, "authentication_error"))).toMatchObject({ code: "invalid_key" });
    expect(await fail(new Anthropic.APIConnectionError({ message: "fetch failed" }))).toMatchObject({ code: "unavailable", message: "anthropic unreachable" });
    expect(JSON.stringify(twice)).not.toContain("details from Anthropic");
    expect(twice.message).not.toContain("details");
  });
});

describe("chat completions adapters", () => {
  it("send the system and user messages and read the answer and tokens", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ model: "gpt-x", choices: [{ message: { content: " Minuta " }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
    }) as typeof fetch;
    expect(openaiChat(fetcher).defaultModel).toBe("gpt-6.1-sol");
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
  /** Gemini's server-sent events, cut into pieces that do not follow line ends. */
  const sse = (chunks: object[], cut = 7) => {
    const text = chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join("");
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += cut) controller.enqueue(bytes.subarray(i, i + cut));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  };

  it("streams the answer with the key header, the system instruction and a thinking level", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return sse([
        { candidates: [{ content: { parts: [{ text: "pensando", thought: true }, { text: "Á" }] } }] },
        { candidates: [{ content: { parts: [{ text: "B" }] }, finishReason: "STOP" }], modelVersion: "gemini-x",
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 3 } },
      ]);
    }) as typeof fetch;
    expect(gemini(fetcher).defaultModel).toBe("gemini-3.8-flash");
    const r = await gemini(fetcher).complete({ ...req, json: true, effort: "low" }, { apiKey: "g", model: "gemini-3.8-flash" });
    expect(r).toEqual({ text: "ÁB", model: "gemini-x", inputTokens: 4, outputTokens: 5 });
    expect(seen!.url).toContain("/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(seen!.url).not.toContain("key=");
    expect((seen!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "LOW" } });
  });

  it("sends a thinking level only to Gemini 3 and later", () => {
    expect(thinkingLevel("gemini-3.8-flash", "medium")).toBe("MEDIUM");
    expect(thinkingLevel("gemini-4-pro", "high")).toBe("HIGH");
    expect(thinkingLevel("gemini-2.5-flash", "low")).toBeUndefined();
    expect(thinkingLevel("gemini-flash-latest", "low")).toBeUndefined();
    expect(thinkingLevel("gemini-3.8-flash", undefined)).toBeUndefined();
  });

  it("explains streams that end without an answer or break off", async () => {
    const run = (res: () => Response) => gemini((async () => res()) as unknown as typeof fetch).complete(req, { apiKey: "g", model: "gemini-3.8-flash" });
    await expect(run(() => sse([{ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] }]))).rejects.toMatchObject({ code: "too_long" });
    await expect(run(() => sse([{ candidates: [{ finishReason: "SAFETY" }] }]))).rejects.toMatchObject({ code: "refused" });
    await expect(run(() => sse([{ promptFeedback: { blockReason: "OTHER" } }]))).rejects.toMatchObject({ code: "refused" });
    await expect(run(() => sse([{ error: { status: "UNAVAILABLE", code: 503 } }]))).rejects.toMatchObject({ code: "overloaded", message: "gemini stream UNAVAILABLE" });
    const broken = () => new Response(new ReadableStream({ pull(c) { c.error(new Error("Network connection lost")); } }));
    await expect(run(broken)).rejects.toMatchObject({ code: "unavailable", message: "gemini stream broke off" });
  });

  it("tells a location block and other refusals apart, logging only status codes", async () => {
    const answer = (status: number, error: object) => (async () => new Response(JSON.stringify({ error }), { status })) as unknown as typeof fetch;
    const where = { status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." };
    await expect(gemini(answer(400, where)).complete(req, { apiKey: "g", model: "m" })).rejects.toMatchObject({ code: "region", message: "gemini 400 FAILED_PRECONDITION" });
    await expect(gemini(answer(400, where)).checkKey("g")).rejects.toMatchObject({ code: "region" });
    await expect(gemini(answer(400, { status: "INVALID_ARGUMENT", message: "The input token count exceeds the maximum." })).complete(req, { apiKey: "g", model: "m" }))
      .rejects.toMatchObject({ code: "too_long" });
    await expect(gemini(answer(503, { status: "UNAVAILABLE", message: "The model is overloaded." })).complete(req, { apiKey: "g", model: "m" }))
      .rejects.toMatchObject({ code: "overloaded", message: "gemini 503 UNAVAILABLE" });
    await expect(gemini(answer(400, { status: "INVALID_ARGUMENT", message: "API key not valid." })).checkKey("g")).resolves.toBe(false);
    const openaiRegion = answer(403, { code: "unsupported_country_region_territory", message: "Country not supported" });
    await expect(openaiChat(openaiRegion).complete(req, { apiKey: "k", model: "m" })).rejects.toMatchObject({ code: "region", message: "openai 403 unsupported_country_region_territory" });
    await expect(openaiChat(openaiRegion).checkKey("k")).rejects.toMatchObject({ code: "region" });
    await expect(openaiChat(answer(403, { code: "forbidden" })).checkKey("k")).resolves.toBe(false);
  });

  it("asks once more with the model's default thinking when a model rejects the level", async () => {
    const bodies: any[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) return new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "Thinking level MEDIUM is not supported for this model." } }), { status: 400 });
      return sse([{ candidates: [{ content: { parts: [{ text: "Hola" }] }, finishReason: "STOP" }] }]);
    }) as unknown as typeof fetch;
    const r = await gemini(fetcher).complete({ ...req, effort: "medium" }, { apiKey: "g", model: "gemini-3.5-pro" });
    expect(r.text).toBe("Hola");
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM" });
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
    const always = (async () => new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "x" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(gemini(always).complete({ ...req, effort: "low" }, { apiKey: "g", model: "gemini-3.5-pro" })).rejects.toMatchObject({ code: "rejected", message: "gemini 400 INVALID_ARGUMENT" });
  });

  it("moves to a lighter model when Google turns the chosen one away, and says which one wrote", async () => {
    const asked: string[] = [];
    const busy = { error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } };
    const fetcher = (async (url: string) => {
      const model = decodeURIComponent(/models\/([^:]+):/.exec(url)![1]!);
      asked.push(model);
      if (model === "gemini-3.8-flash") return new Response(JSON.stringify(busy), { status: 503 });
      // The first light model breaks off before any text; the next one answers.
      if (model === GEMINI_FALLBACKS[0]) return sse([{ error: { status: "UNAVAILABLE", code: 503 } }]);
      return sse([{ candidates: [{ content: { parts: [{ text: "Minuta" }] }, finishReason: "STOP" }], modelVersion: model }]);
    }) as unknown as typeof fetch;
    const r = await gemini(fetcher).complete({ ...req, effort: "medium" }, { apiKey: "g", model: "gemini-3.8-flash" });
    expect(asked).toEqual(["gemini-3.8-flash", ...GEMINI_FALLBACKS]);
    expect(r).toMatchObject({ text: "Minuta", model: GEMINI_FALLBACKS[1] });
  });

  it("does not move to another model when the request itself is wrong, or an answer had started", async () => {
    const asked: string[] = [];
    const rejecting = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "x" } }), { status: 400 });
    }) as unknown as typeof fetch;
    await expect(gemini(rejecting).complete(req, { apiKey: "g", model: "gemini-3.8-flash" })).rejects.toMatchObject({ code: "rejected" });
    expect(asked).toHaveLength(1);
    const halfway = (async () => sse([{ candidates: [{ content: { parts: [{ text: "Medio" }] } }] }, { error: { status: "UNAVAILABLE", code: 503 } }])) as unknown as typeof fetch;
    await expect(gemini(halfway).complete(req, { apiKey: "g", model: "gemini-3.8-flash" })).rejects.toMatchObject({ code: "overloaded", partial: true });
  });

  it("gives up on a provider that holds the connection without answering", async () => {
    const silent = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    await expect(llmCall("gemini", silent, "https://x", {}, 5_000, 20)).rejects.toMatchObject({ code: "overloaded", message: "gemini did not start answering" });
  });

  it("knows an invalid key behind Gemini's 400", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API key not valid." } }), { status: 400 })) as unknown as typeof fetch;
    await expect(gemini(fetcher).complete(req, { apiKey: "g", model: "m" })).rejects.toMatchObject({ code: "invalid_key" });
  });
});

describe("prompt helpers", () => {
  it("write in the transcript's language, not the screen's", () => {
    const tr = (language: string | null, ...texts: string[]) => ({ ...transcript(), language, blocks: texts.map((text, i) => ({ speaker: i % 2, start: i, end: i + 1, text })) });
    expect(contentLanguage(tr("es", "Hello"), "en")).toBe("es");
    expect(contentLanguage(tr("en-US", "Hola"), "es")).toBe("en");
    expect(contentLanguage(tr(null, "Buenos días a todos, empecemos con la agenda de la sesión.", "Gracias, el informe de la tesorería está en el acta."), "en")).toBe("es");
    expect(contentLanguage(tr("multi", "Good morning, this is the budget and we have the report for the board.", "Thanks, that is what we need."), "es")).toBe("en");
    expect(contentLanguage(tr("pt", "Bom dia"), "es")).toBe("es");
  });

  it("merge consecutive blocks of a voice into one line with its time", () => {
    const tr = transcript();
    tr.blocks.push({ speaker: 1, start: 9.5, end: 12, text: "Primer punto." });
    expect(transcriptLines(tr, (s) => `S${s}`)).toBe("[00:00] S0: Buenos días a todos.\n[00:04] S1: Empecemos con la agenda. Primer punto.");
  });

  it("find the JSON in an answer and keep valid suggestions only", () => {
    expect(firstJsonObject('```json\n{"speakers": []}\n```')).toEqual({ speakers: [] });
    expect(firstJsonObject("sin json")).toBeNull();
    const ok = parseSuggestions({ speakers: [{ speaker: 1, name: " Marco ", evidence: "x" }, { speaker: 1, name: "Otro" }, { speaker: "2", name: "Ana" }, { speaker: 9, name: "Z" }] }, new Set([0, 1, 2]));
    expect(ok).toEqual([{ speaker: 1, name: "Marco", evidence: "x", confidence: "low" }, { speaker: 2, name: "Ana", evidence: "", confidence: "low" }]);
    const rated = parseSuggestions({ speakers: [{ speaker: 0, name: "A", confidence: "alta" }, { speaker: 1, name: "B", confidence: "medium" }, { speaker: 2, name: "C", confidence: "?" }] }, new Set([0, 1, 2]));
    expect(rated.map((s) => s.confidence)).toEqual(["high", "medium", "low"]);
  });
});

describe("slow answers", () => {
  const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  it("go out as they are when they are quick", async () => {
    const res = await keepAlive(later(5, Response.json({ ok: 1 }, { status: 201 })), { after: 50, every: 10 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it("keep the connection alive with spaces, then send the JSON or the error with its status", async () => {
    const res = await keepAlive(later(60, Response.json({ minutes: "x" })), { after: 10, every: 15 });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/^ {2,}\{"minutes":"x"\}$/);
    const failed = await keepAlive(later(30, Response.json({ error: "llm_unavailable" }, { status: 502 })), { after: 5, every: 10 });
    expect(JSON.parse(await failed.text())).toEqual({ error: "llm_unavailable", errorStatus: 502 });
    const crashed = await keepAlive(later(20, null).then(() => Promise.reject(new Error("boom"))), { after: 5, every: 10 });
    expect(await crashed.json()).toEqual({ error: "generic", errorStatus: 500 });
  });

  it("work inside a Hono route whose answer comes after the handler returned", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
    });
    app.post("/slow", (c) => keepAlive(later(40, null).then(() => c.json({ error: "llm_unavailable" }, 502)), { after: 5, every: 10 }));
    const res = await app.request("/slow", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(JSON.parse(await res.text())).toEqual({ error: "llm_unavailable", errorStatus: 502 });
  });
});
