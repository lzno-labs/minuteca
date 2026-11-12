// Claude, through Anthropic's official SDK (https://platform.claude.com/docs).
import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmAdapter } from "./llm.ts";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** "anthropic 400 invalid_request_error": the status and the error type, never Anthropic's text. */
function why(err: InstanceType<typeof Anthropic.APIError>): string {
  const type = err.type ?? (err.error as { error?: { type?: unknown } } | undefined)?.error?.type;
  return `anthropic ${err.status ?? "?"}${typeof type === "string" ? ` ${type}` : ""}`;
}

/** A 400 for a transcript too long for the model (read here, never passed on). */
const tooLong = (err: unknown) => err instanceof Anthropic.BadRequestError && /prompt is too long|too many tokens|context (window|length)/i.test(err.message);

/** The SDK's typed errors to our codes, without the provider's message. */
function fromSdkError(err: unknown): LlmError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new LlmError("invalid_key", why(err));
  if (err instanceof Anthropic.NotFoundError) return new LlmError("model_not_found", why(err));
  if (err instanceof Anthropic.RateLimitError) return new LlmError("rate_limited", why(err));
  if (tooLong(err)) return new LlmError("too_long", why(err as InstanceType<typeof Anthropic.APIError>));
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("timeout", "anthropic timed out");
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("unavailable", "anthropic unreachable");
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return new LlmError(status >= 400 && status < 500 ? "rejected" : status >= 500 ? "overloaded" : "unavailable", why(err));
  }
  return new LlmError("unavailable", `anthropic ${(err as Error)?.name ?? "error"}`);
}

export function anthropic(makeClient: (apiKey: string) => Anthropic = (apiKey) => new Anthropic({ apiKey, timeout: 300_000, maxRetries: 2 })): LlmAdapter {
  return {
    id: "anthropic",
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    needsKey: true,
    async complete(req, { apiKey, model }) {
      const client = makeClient(apiKey);
      const plain = { model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user" as const, content: req.prompt }] };
      let message;
      try {
        // Streaming with finalMessage(): long transcripts and long minutes stay clear of HTTP timeouts.
        // fallbacks "default": if a safety classifier declines, the API reruns the request on
        // Anthropic's recommended model for that case instead of returning the refusal.
        message = await client.beta.messages
          .stream({ ...plain, output_config: { effort: req.effort ?? "medium" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
          .finalMessage();
      } catch (err) {
        // A model chosen in Settings may not take effort or refusal fallbacks (Haiku, older models):
        // the 400 costs nothing, so the request goes once more without them.
        if (!(err instanceof Anthropic.BadRequestError) || tooLong(err)) throw fromSdkError(err);
        try {
          message = await client.beta.messages.stream(plain).finalMessage();
        } catch (again) {
          throw fromSdkError(again);
        }
      }
      if (message.stop_reason === "refusal") throw new LlmError("refused", "anthropic declined the request");
      const text = message.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { text, model: message.model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
    },
    async checkKey(apiKey) {
      try {
        await makeClient(apiKey).models.list({ limit: 1 });
        return true;
      } catch (err) {
        const e = fromSdkError(err);
        if (e.code === "invalid_key") return false;
        throw e;
      }
    },
  };
}
