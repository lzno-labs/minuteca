/** Language model providers for names and minutes; names and notes live in locales (llmProviders.<id>). */
export const LLM_IDS = ["anthropic", "gemini", "openai", "openrouter", "local"];

/** What the chosen language model still needs before it can be used: null when ready. */
export function llmMissing(me) {
  const id = me?.llm?.provider;
  const p = me?.llm?.providers?.find((x) => x.id === id);
  if (!id || !p) return "provider";
  if (p.needsKey && !p.ownKey) return "key";
  return null;
}

export const llmConsentId = (id) => `llm:${id}`;
