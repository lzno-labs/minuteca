import { anthropic } from "./anthropic.ts";
import { gemini } from "./gemini.ts";
import type { LlmAdapter, LlmProviderId } from "./llm.ts";
import { localChat, openaiChat, openrouter } from "./openai-chat.ts";

/** The language model adapters this server offers. "local" only when its address is configured. */
export function llmAdapters(env: Record<string, string | undefined>): Partial<Record<LlmProviderId, LlmAdapter>> {
  const out: Partial<Record<LlmProviderId, LlmAdapter>> = { anthropic: anthropic(), gemini: gemini(), openai: openaiChat(), openrouter: openrouter() };
  if (env.MINUTECA_LLM_LOCAL_URL) out.local = localChat(env.MINUTECA_LLM_LOCAL_URL, env.MINUTECA_LLM_LOCAL_MODEL || "llama3.1");
  return out;
}
