/**
 * The language model boundary (docs/adr/0004-language-models.md): suggesting speaker names and
 * writing minutes from a transcript. Each provider is an adapter; every call goes through
 * runLlm() in ../minutes.ts, which checks permission, picks the person's key and meters tokens.
 */
export const LLM_PROVIDERS = ["anthropic", "gemini", "openai", "openrouter", "local"] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

export const isLlmProvider = (p: unknown): p is LlmProviderId => typeof p === "string" && (LLM_PROVIDERS as readonly string[]).includes(p);

export interface LlmRequest {
  system: string;
  prompt: string;
  /** Upper bound for the answer. */
  maxTokens: number;
  /** Ask for a JSON object (providers that support a JSON mode use it). */
  json?: boolean;
  /** How much reasoning the task deserves, for providers that take it. */
  effort?: "low" | "medium" | "high";
}

export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmAdapter {
  id: LlmProviderId;
  defaultModel: string;
  /** false for the local model, which the server administrator configures. */
  needsKey: boolean;
  complete(req: LlmRequest, options: { apiKey: string; model: string }): Promise<LlmResult>;
  /** true if the provider accepts the key. Sends the key only to that provider. */
  checkKey(apiKey: string): Promise<boolean>;
}

/** `region`: the provider refuses requests from where the server runs (Gemini and OpenAI block some countries). */
/**
 * rejected: the provider refused the request itself (a 4xx it does not explain otherwise, often a
 * model that does not take an option). overloaded: the provider failed on its side (5xx).
 * unavailable: no answer, or the answer broke off.
 */
export type LlmErrorCode = "invalid_key" | "model_not_found" | "refused" | "too_long" | "rate_limited" | "rejected" | "overloaded" | "unavailable" | "timeout" | "empty_answer" | "region";

/**
 * Errors carry a code the app can show. The message holds only the provider, the HTTP status and the
 * provider's error type, so it is logged and also shown to the person as a detail they can pass on;
 * provider error texts never reach people or logs.
 */
export class LlmError extends Error {
  code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function llmErrorFor(provider: string, status: number): LlmError {
  if (status === 401 || status === 403) return new LlmError("invalid_key", `${provider} rejected the key (${status})`);
  if (status === 404) return new LlmError("model_not_found", `${provider}: model not found`);
  if (status === 413) return new LlmError("too_long", `${provider}: input too long`);
  if (status === 429) return new LlmError("rate_limited", `${provider}: rate limited or out of credit`);
  if (status >= 400 && status < 500) return new LlmError("rejected", `${provider} ${status}`);
  if (status >= 500) return new LlmError("overloaded", `${provider} ${status}`);
  return new LlmError("unavailable", `${provider} ${status}`);
}

export type Fetcher = typeof fetch;

/**
 * A provider request with an overall time limit, and optionally a limit for the answer to start
 * (headersMs): a provider swamped with requests sometimes holds the connection open without a word.
 */
export async function llmCall(provider: string, fetcher: Fetcher, url: string, init: RequestInit, timeoutMs = 300_000, headersMs?: number): Promise<Response> {
  const start = new AbortController();
  const wait = headersMs ? setTimeout(() => start.abort(), headersMs) : undefined;
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), start.signal]) });
  } catch (err) {
    if (start.signal.aborted) throw new LlmError("overloaded", `${provider} did not start answering`);
    if ((err as Error).name === "TimeoutError") throw new LlmError("timeout", `${provider} timed out`);
    throw new LlmError("unavailable", `could not reach ${provider}`);
  } finally {
    clearTimeout(wait);
  }
}

/** Model ids people may type in Settings: letters, digits and . _ : / - only. */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
