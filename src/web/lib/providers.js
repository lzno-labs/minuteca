/** Transcription providers known to the server; names and descriptions live in locales (providers.<id>). */
export const PROVIDER_IDS = ["deepgram", "assemblyai", "openai"];

/** Which key would pay for a transcription with this provider: "own", "hosted" or null. */
export function keySource(me, provider) {
  const p = me?.providers?.find((x) => x.id === provider);
  if (!p) return null;
  if (p.ownKey) return "own";
  if (p.hosted && (me.hosted?.remainingSeconds ?? 0) > 0) return "hosted";
  return null;
}

/** The provider to use now: the chosen one if it has a key, else the first one that has. */
export function usableProvider(me) {
  if (keySource(me, me?.provider)) return me.provider;
  return PROVIDER_IDS.find((id) => keySource(me, id)) ?? null;
}
