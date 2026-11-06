// Claude, through Anthropic's official SDK (https://platform.claude.com/docs).
import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmAdapter } from "./llm.ts";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** The SDK's typed errors to our codes, without the provider's message. */
function fromSdkError(err: unknown): LlmError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new LlmError("invalid_key", "anthropic rejected the key");
  if (err instanceof Anthropic.NotFoundError) return new LlmError("model_not_found", "anthropic: model not found");
  if (err instanceof Anthropic.RateLimitError) return new LlmError("rate_limited", "anthropic: rate limited");
  if (err instanceof Anthropic.BadRequestError) return new LlmError("unavailable", "anthropic refused the request");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("timeout", "anthropic timed out");
  if (err instanceof Anthropic.APIError) return new LlmError("unavailable", `anthropic answered ${err.status ?? "?"}`);
  return new LlmError("unavailable", "could not reach anthropic");
}

export function anthropic(makeClient: (apiKey: string) => Anthropic = (apiKey) => new Anthropic({ apiKey, timeout: 300_000, maxRetries: 2 })): LlmAdapter {
  return {
    id: "anthropic",
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    needsKey: true,
    async complete(req, { apiKey, model }) {
      const client = makeClient(apiKey);
      let message;
      try {
        // Streaming with finalMessage(): long transcripts and long minutes stay clear of HTTP timeouts.
        // fallbacks "default": if a safety classifier declines, the API reruns the request on
        // Anthropic's recommended model for that case instead of returning the refusal.
        message = await client.beta.messages
          .stream({
            model,
            max_tokens: req.maxTokens,
            system: req.system,
            output_config: { effort: req.effort ?? "medium" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages: [{ role: "user", content: req.prompt }],
          })
          .finalMessage();
      } catch (err) {
        throw fromSdkError(err);
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
