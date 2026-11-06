/**
 * Language models for the minutes (docs/design/minutes-with-llm.md): suggesting who each voice is
 * and writing the minutes from the transcript. runLlm() is the one place that calls a language
 * model: it checks the person's permission for that provider, uses their own key (or the local
 * model the server administrator set up), and writes the tokens to the usage ledger.
 */
import { t } from "./i18n.ts";
import type { KeyVault } from "./keys.ts";
import { LlmError, type LlmAdapter, type LlmProviderId, type LlmRequest, type LlmResult } from "./llm/llm.ts";
import type { MeetingRow, Store, User } from "./storage/store.ts";
import type { Transcript } from "./transcriber/transcriber.ts";

export interface MinutesDeps {
  store: Store;
  vault: KeyVault | null;
  llm: Partial<Record<LlmProviderId, LlmAdapter>>;
  now: () => number;
  /** Time zone for dates written in the minutes. */
  timeZone: string;
}

export type MinutesErrorCode = "no_llm" | "no_llm_key" | "no_llm_consent" | "not_found" | "not_transcribed";

export class MinutesError extends Error {
  code: MinutesErrorCode;
  status: number;
  constructor(code: MinutesErrorCode, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** The model a person uses with a provider: their choice, or the provider's default. */
export function modelFor(user: User, adapter: LlmAdapter): string {
  return user.llmModels[adapter.id] || adapter.defaultModel;
}

/** THE function every language model call goes through. */
export async function runLlm(
  deps: MinutesDeps,
  user: User,
  call: { purpose: "speakers" | "minutes"; meetingId: string | null; request: LlmRequest },
): Promise<LlmResult & { provider: LlmProviderId }> {
  const provider = user.llmProvider;
  const adapter = provider ? deps.llm[provider] : undefined;
  if (!provider || !adapter) throw new MinutesError("no_llm", 409);
  if (!user.consents.includes(`llm:${provider}`)) throw new MinutesError("no_llm_consent", 403);
  let apiKey = "";
  if (adapter.needsKey) {
    const sealed = deps.vault ? await deps.store.sealedKey(user.id, provider) : null;
    if (!sealed || !deps.vault) throw new MinutesError("no_llm_key", 402);
    apiKey = await deps.vault.open(user.id, provider, sealed);
  }
  const result = await adapter.complete(call.request, { apiKey, model: modelFor(user, adapter) });
  await deps.store.addLlmUsage({
    userId: user.id,
    meetingId: call.meetingId,
    provider,
    model: result.model,
    purpose: call.purpose,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    now: deps.now(),
  });
  if (!result.text) throw new LlmError("empty_answer", "the model returned no text");
  return { ...result, provider };
}

const clock = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(total % 60)}` : `${pad(m)}:${pad(total % 60)}`;
};

/** "Persona 1", "Persona 2"...: the label the app shows for a voice without a name. */
const defaultName = (lang: string, speaker: number) => t(lang, "speakers.default", { n: speaker + 1 });

/** The transcript as lines, consecutive blocks of the same voice merged. */
export function transcriptLines(tr: Transcript, label: (speaker: number) => string): string {
  const out: string[] = [];
  let last: { speaker: number; start: number; text: string } | null = null;
  for (const b of tr.blocks) {
    if (last && last.speaker === b.speaker) {
      last.text += ` ${b.text}`;
      continue;
    }
    if (last) out.push(`[${clock(last.start)}] ${label(last.speaker)}: ${last.text}`);
    last = { speaker: b.speaker, start: b.start, text: b.text };
  }
  if (last) out.push(`[${clock(last.start)}] ${label(last.speaker)}: ${last.text}`);
  return out.join("\n");
}

async function transcribed(deps: MinutesDeps, user: User, meetingId: string): Promise<{ m: MeetingRow; tr: Transcript; names: Record<string, string> }> {
  const m = await deps.store.meeting(user.id, meetingId);
  if (!m) throw new MinutesError("not_found", 404);
  const tr = m.status === "done" ? await deps.store.transcript(m.id) : null;
  if (!tr) throw new MinutesError("not_transcribed", 409);
  let names: Record<string, string> = {};
  try {
    names = JSON.parse(m.speaker_names) as Record<string, string>;
  } catch {
    names = {};
  }
  return { m, tr, names };
}

export interface SpeakerSuggestion {
  speaker: number;
  name: string;
  evidence: string;
}

/** The first JSON object in a model's answer (some wrap it in prose or code fences). */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Keeps only suggestions for voices that exist, with a short name, never invented structure. */
export function parseSuggestions(raw: unknown, speakers: Set<number>): SpeakerSuggestion[] {
  const list = (raw as { speakers?: unknown })?.speakers;
  if (!Array.isArray(list)) return [];
  const out: SpeakerSuggestion[] = [];
  for (const item of list) {
    const s = item as { speaker?: unknown; name?: unknown; evidence?: unknown };
    const speaker = Number(s.speaker);
    const name = typeof s.name === "string" ? s.name.trim().slice(0, 100) : "";
    if (!Number.isInteger(speaker) || !speakers.has(speaker) || !name || out.some((o) => o.speaker === speaker)) continue;
    out.push({ speaker, name, evidence: typeof s.evidence === "string" ? s.evidence.trim().slice(0, 300) : "" });
  }
  return out;
}

/** Asks the model who each voice is, from what people say ("Gracias, Marco"). Nothing is saved: the person picks. */
export async function suggestSpeakers(deps: MinutesDeps, user: User, meetingId: string, lang: string) {
  const { m, tr } = await transcribed(deps, user, meetingId);
  const speakers = new Set(tr.blocks.map((b) => b.speaker));
  const label = (s: number) => `S${s}`;
  const result = await runLlm(deps, user, {
    purpose: "speakers",
    meetingId: m.id,
    request: {
      system: t(lang, "prompts.speakers.system"),
      prompt: t(lang, "prompts.speakers.user", {
        speakers: [...speakers].sort((a, b) => a - b).map(label).join(", "),
        transcript: transcriptLines(tr, label),
      }),
      // Reasoning models count their thinking in this limit, so it is generous.
      maxTokens: 8000,
      json: true,
      effort: "low",
    },
  });
  return { suggestions: parseSuggestions(firstJsonObject(result.text), speakers), provider: result.provider, model: result.model };
}

/** Writes the minutes from the transcript with the people's names, and saves them with the meeting. */
export async function generateMinutes(deps: MinutesDeps, user: User, meetingId: string, lang: string) {
  const { m, tr, names } = await transcribed(deps, user, meetingId);
  const label = (s: number) => names[String(s)]?.trim() || defaultName(lang, s);
  const participants = [...new Set(tr.blocks.map((b) => label(b.speaker)))];
  const locale = t(lang, "meta.locale");
  const date = new Date(m.date).toLocaleString(locale, { dateStyle: "full", timeStyle: "short", timeZone: deps.timeZone });
  const instructions = user.minutesInstructions.trim();
  const result = await runLlm(deps, user, {
    purpose: "minutes",
    meetingId: m.id,
    request: {
      system: t(lang, "prompts.minutes.system"),
      prompt: t(lang, "prompts.minutes.user", {
        title: m.title,
        date,
        duration: `${Math.round((tr.duration || m.duration) / 60)} min`,
        participants: participants.join(", "),
        instructions: instructions ? t(lang, "prompts.minutes.instructions", { instructions }) : "",
        transcript: transcriptLines(tr, label),
      }),
      maxTokens: 16000,
      effort: "medium",
    },
  });
  await deps.store.saveMinutes(m.id, { body: result.text, provider: result.provider, model: result.model, edited: false }, deps.now());
  return (await deps.store.minutes(m.id))!;
}
