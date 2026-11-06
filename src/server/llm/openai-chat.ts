// Chat Completions adapters: OpenAI, OpenRouter (one key, many models) and a local server that
// speaks the same API (Ollama, LM Studio, llama.cpp), set up by whoever runs minuteca.
import { llmCall, llmErrorFor, LlmError, type Fetcher, type LlmAdapter, type LlmProviderId } from "./llm.ts";

interface ChatOptions {
  id: LlmProviderId;
  baseUrl: string;
  defaultModel: string;
  needsKey: boolean;
  /** GET path that answers 200 only with a valid key. */
  keyCheckPath: string;
  extraHeaders?: Record<string, string>;
}

export function chatCompletions(o: ChatOptions, fetcher: Fetcher = fetch): LlmAdapter {
  const headers = (apiKey: string) => ({
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...o.extraHeaders,
  });
  return {
    id: o.id,
    defaultModel: o.defaultModel,
    needsKey: o.needsKey,
    async complete(req, { apiKey, model }) {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        max_completion_tokens: req.maxTokens,
      };
      if (req.json) body.response_format = { type: "json_object" };
      const r = await llmCall(o.id, fetcher, `${o.baseUrl}/chat/completions`, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body) });
      if (!r.ok) throw llmErrorFor(o.id, r.status);
      const j = (await r.json()) as any;
      const choice = j?.choices?.[0];
      if (choice?.finish_reason === "content_filter") throw new LlmError("refused", `${o.id} filtered the answer`);
      return {
        text: String(choice?.message?.content ?? "").trim(),
        model: String(j?.model ?? model),
        inputTokens: Number(j?.usage?.prompt_tokens ?? 0),
        outputTokens: Number(j?.usage?.completion_tokens ?? 0),
      };
    },
    async checkKey(apiKey) {
      const r = await llmCall(o.id, fetcher, `${o.baseUrl}${o.keyCheckPath}`, { headers: headers(apiKey) }, 15_000);
      if (r.status === 401 || r.status === 403) return false;
      if (!r.ok) throw llmErrorFor(o.id, r.status);
      return true;
    },
  };
}

export const OPENAI_DEFAULT_MODEL = "gpt-5.4-mini";
export const OPENROUTER_DEFAULT_MODEL = "openrouter/auto";

export const openaiChat = (fetcher?: Fetcher) =>
  chatCompletions({ id: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: OPENAI_DEFAULT_MODEL, needsKey: true, keyCheckPath: "/models" }, fetcher);

export const openrouter = (fetcher?: Fetcher) =>
  chatCompletions(
    {
      id: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: OPENROUTER_DEFAULT_MODEL,
      needsKey: true,
      keyCheckPath: "/key",
      extraHeaders: { "X-Title": "minuteca" },
    },
    fetcher,
  );

/** Only when the server administrator sets MINUTECA_LLM_LOCAL_URL; people cannot point the server at other addresses. */
export const localChat = (baseUrl: string, model: string, fetcher?: Fetcher) =>
  chatCompletions({ id: "local", baseUrl: baseUrl.replace(/\/$/, ""), defaultModel: model, needsKey: false, keyCheckPath: "/models" }, fetcher);
