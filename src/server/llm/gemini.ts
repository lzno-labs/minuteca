// Google Gemini (https://ai.google.dev/api/generate-content).
import { llmCall, llmErrorFor, LlmError, type Fetcher, type LlmAdapter } from "./llm.ts";

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

export function gemini(fetcher: Fetcher = fetch): LlmAdapter {
  return {
    id: "gemini",
    defaultModel: GEMINI_DEFAULT_MODEL,
    needsKey: true,
    async complete(req, { apiKey, model }) {
      const body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens, ...(req.json ? { responseMimeType: "application/json" } : {}) },
      };
      const r = await llmCall("gemini", fetcher, `${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await geminiError(r);
      const j = (await r.json()) as any;
      const candidate = j?.candidates?.[0];
      if (!candidate && j?.promptFeedback?.blockReason) throw new LlmError("refused", "gemini blocked the request");
      if (candidate?.finishReason === "SAFETY") throw new LlmError("refused", "gemini blocked the answer");
      const text = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      return {
        text,
        model: String(j?.modelVersion ?? model),
        inputTokens: Number(j?.usageMetadata?.promptTokenCount ?? 0),
        outputTokens: Number(j?.usageMetadata?.candidatesTokenCount ?? 0),
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
