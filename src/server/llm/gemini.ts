// Google Gemini (https://ai.google.dev/api/generate-content).
import { llmCall, llmErrorFor, LlmError, type Fetcher, type LlmAdapter, type LlmRequest } from "./llm.ts";

/**
 * Gemini's error body says why it refused: an invalid key and an unsupported location both come as 400
 * (or FAILED_PRECONDITION). Only the status enum goes into the message, never Google's text.
 */
async function geminiError(r: Response): Promise<LlmError> {
  const e = ((await r.json().catch(() => ({}))) as { error?: { status?: string; message?: string } }).error ?? {};
  const message = e.message ?? "";
  const why = `gemini ${r.status}${e.status ? ` ${e.status}` : ""}`;
  if (/api key/i.test(message) && r.status === 400) return new LlmError("invalid_key", why);
  if (e.status === "FAILED_PRECONDITION" || /location is not supported/i.test(message)) return new LlmError("region", why);
  if (r.status === 400 && /token|too long|exceed/i.test(message)) return new LlmError("too_long", why);
  return new LlmError(llmErrorFor("gemini", r.status).code, why);
}

const API = "https://generativelanguage.googleapis.com/v1beta";
/**
 * Google's current stable Flash model (ai.google.dev/gemini-api/docs/models, read 2026-11-06).
 * Not the gemini-flash-latest alias: Google says it can point to preview releases and recommends a
 * specific stable model in production. People can pick another in Settings.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";

/**
 * Gemini 3 and later take a thinking level (Flash defaults to medium). Older models reject the field, so
 * it is only sent when the model id says 3 or later (aliases like gemini-flash-latest get the default).
 */
export function thinkingLevel(model: string, effort: LlmRequest["effort"]): string | undefined {
  const major = Number(/^gemini-(\d+)/.exec(model)?.[1] ?? 0);
  if (major < 3 || !effort) return undefined;
  return effort.toUpperCase();
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { status?: string; message?: string; code?: number };
}

/** Reads Gemini's server-sent events: one JSON chunk per `data:` line. */
async function* sseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<GeminiChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line: string) => (line.startsWith("data:") ? (JSON.parse(line.slice(5).trim()) as GeminiChunk) : null);
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      const chunk = parse(line);
      if (chunk) yield chunk;
    }
    if (done) return;
  }
}

export function gemini(fetcher: Fetcher = fetch): LlmAdapter {
  return {
    id: "gemini",
    defaultModel: GEMINI_DEFAULT_MODEL,
    needsKey: true,
    async complete(req, { apiKey, model }) {
      const level = thinkingLevel(model, req.effort);
      const send = (thinking: string | undefined) =>
        // Streamed, so the connection is never silent while the model thinks: Cloudflare drops a
        // subrequest that sends nothing for about 100 seconds.
        llmCall("gemini", fetcher, `${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: "user", parts: [{ text: req.prompt }] }],
            generationConfig: {
              maxOutputTokens: req.maxTokens,
              ...(req.json ? { responseMimeType: "application/json" } : {}),
              ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
            },
          }),
        });
      let r = await send(level);
      if (!r.ok) {
        const e = await geminiError(r);
        // A model chosen in Settings may not take that thinking level: once more with its default.
        if (e.code !== "rejected" || !level) throw e;
        r = await send(undefined);
        if (!r.ok) throw await geminiError(r);
      }
      if (!r.body) throw new LlmError("unavailable", "gemini 200 without a body");
      let text = "";
      let finish = "";
      let blocked = false;
      let usage: GeminiChunk["usageMetadata"] = {};
      let version = model;
      try {
        for await (const chunk of sseChunks(r.body)) {
          if (chunk.error) {
            const code = chunk.error.status === "RESOURCE_EXHAUSTED" ? "rate_limited" : chunk.error.status === "UNAVAILABLE" || chunk.error.status === "INTERNAL" ? "overloaded" : "unavailable";
            throw new LlmError(code, `gemini stream ${chunk.error.status ?? chunk.error.code ?? "error"}`);
          }
          const candidate = chunk.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) if (!part.thought) text += part.text ?? "";
          if (candidate?.finishReason) finish = candidate.finishReason;
          if (chunk.promptFeedback?.blockReason) blocked = true;
          if (chunk.usageMetadata) usage = chunk.usageMetadata;
          if (chunk.modelVersion) version = chunk.modelVersion;
        }
      } catch (e) {
        if (e instanceof LlmError) throw e;
        if ((e as Error).name === "TimeoutError") throw new LlmError("timeout", "gemini timed out");
        throw new LlmError("unavailable", "gemini stream broke off");
      }
      if (blocked && !text) throw new LlmError("refused", "gemini blocked the request");
      if (finish === "SAFETY") throw new LlmError("refused", "gemini blocked the answer");
      if (finish === "MAX_TOKENS" && !text.trim()) throw new LlmError("too_long", "gemini used its token limit before answering");
      return {
        text: text.trim(),
        model: String(version),
        inputTokens: Number(usage?.promptTokenCount ?? 0),
        // Thinking tokens are billed as output.
        outputTokens: Number(usage?.candidatesTokenCount ?? 0) + Number(usage?.thoughtsTokenCount ?? 0),
      };
    },
    async checkKey(apiKey) {
      const r = await llmCall("gemini", fetcher, `${API}/models?pageSize=1`, { headers: { "x-goog-api-key": apiKey } }, 15_000);
      if (r.ok) return true;
      const e = await geminiError(r);
      if (e.code === "invalid_key" || r.status === 401 || r.status === 403) return false;
      throw e;
    },
  };
}
