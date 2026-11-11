/** Language model providers for names and minutes; names and notes live in locales (llmProviders.<id>). */
export const LLM_IDS = ["anthropic", "gemini", "openai", "openrouter", "local"];

/** Providers ready to use now: a key saved, or none needed (a local model). In the app's order. */
export function readyLlms(me) {
  const list = me?.llm?.providers ?? [];
  return LLM_IDS.filter((id) => {
    const p = list.find((x) => x.id === id);
    return p && (!p.needsKey || p.ownKey);
  });
}

/** The provider a generation starts with: the default when it is ready, else the first ready one. */
export function startingLlm(me) {
  const ready = readyLlms(me);
  return ready.includes(me?.llm?.provider) ? me.llm.provider : (ready[0] ?? me?.llm?.provider ?? null);
}

/** What a provider (the default one if none is given) still needs before it can be used: null when ready. */
export function llmMissing(me, id = me?.llm?.provider) {
  const p = me?.llm?.providers?.find((x) => x.id === id);
  if (!id || !p) return "provider";
  if (p.needsKey && !p.ownKey) return "key";
  return null;
}

export const llmConsentId = (id) => `llm:${id}`;
