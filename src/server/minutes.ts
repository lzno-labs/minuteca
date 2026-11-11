/**
 * Language models for the minutes (docs/design/minutes-with-llm.md): suggesting who each voice is
 * and writing the minutes from the transcript. runLlm() is the one place that calls a language
 * model: it checks the person's permission for that provider, uses their own key (or the local
 * model the server administrator set up), and writes the tokens to the usage ledger.
 */
import { t } from "./i18n.ts";
import type { KeyVault } from "./keys.ts";
import { isLlmProvider, LlmError, type LlmAdapter, type LlmProviderId, type LlmRequest, type LlmResult } from "./llm/llm.ts";
import type { MeetingRow, MinutesRow, Store, User } from "./storage/store.ts";
import type { Transcript } from "./transcriber/transcriber.ts";

export interface MinutesDeps {
  store: Store;
  vault: KeyVault | null;
  llm: Partial<Record<LlmProviderId, LlmAdapter>>;
  now: () => number;
  /** Time zone for dates written in the minutes. */
  timeZone: string;
}

export type MinutesErrorCode = "no_llm" | "no_llm_key" | "no_llm_consent" | "not_found" | "not_transcribed" | "invalid_provider" | "invalid_instruction" | "minutes_changed";

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

/**
 * The provider a call will use, checked: the person's default, or the one they picked for this
 * generation (to compare models). Throws when there is no permission or key for it.
 */
export async function pickLlm(deps: MinutesDeps, user: User, wanted?: unknown): Promise<{ provider: LlmProviderId; adapter: LlmAdapter; apiKey: string }> {
  let provider = user.llmProvider;
  if (wanted !== undefined && wanted !== null) {
    if (!isLlmProvider(wanted) || !deps.llm[wanted]) throw new MinutesError("invalid_provider", 400);
    provider = wanted;
  }
  const adapter = provider ? deps.llm[provider] : undefined;
  if (!provider || !adapter) throw new MinutesError("no_llm", 409);
  if (!user.consents.includes(`llm:${provider}`)) throw new MinutesError("no_llm_consent", 403);
  let apiKey = "";
  if (adapter.needsKey) {
    const sealed = deps.vault ? await deps.store.sealedKey(user.id, provider) : null;
    if (!sealed || !deps.vault) throw new MinutesError("no_llm_key", 402);
    apiKey = await deps.vault.open(user.id, provider, sealed);
  }
  return { provider, adapter, apiKey };
}

/** THE function every language model call goes through. */
export async function runLlm(
  deps: MinutesDeps,
  user: User,
  call: { purpose: "speakers" | "minutes" | "revise"; meetingId: string | null; request: LlmRequest; provider?: unknown },
): Promise<LlmResult & { provider: LlmProviderId }> {
  const { provider, adapter, apiKey } = await pickLlm(deps, user, call.provider);
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

export type Confidence = "high" | "medium" | "low";

export interface SpeakerSuggestion {
  speaker: number;
  name: string;
  evidence: string;
  confidence: Confidence;
}

/** Models answer in the prompt's language ("alta") or in English ("high"). */
function confidenceOf(value: unknown): Confidence {
  const v = String(value ?? "").toLowerCase();
  if (["high", "alta", "alto"].includes(v)) return "high";
  if (["medium", "media", "medio"].includes(v)) return "medium";
  return "low";
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
    out.push({ speaker, name, evidence: typeof s.evidence === "string" ? s.evidence.trim().slice(0, 300) : "", confidence: confidenceOf((s as { confidence?: unknown }).confidence) });
  }
  return out;
}

/** Asks the model who each voice is, from what people say ("Gracias, Marco"). Nothing is saved: the person picks. */
export async function suggestSpeakers(deps: MinutesDeps, user: User, meetingId: string, lang: string, provider?: unknown) {
  const { m, tr } = await transcribed(deps, user, meetingId);
  const speakers = new Set(tr.blocks.map((b) => b.speaker));
  const label = (s: number) => `S${s}`;
  const result = await runLlm(deps, user, {
    purpose: "speakers",
    meetingId: m.id,
    provider,
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

/** Writes the minutes from the transcript with the people's names, and saves them as a new version. */
export async function generateMinutes(deps: MinutesDeps, user: User, meetingId: string, lang: string, provider?: unknown) {
  const { m, tr, names } = await transcribed(deps, user, meetingId);
  const label = (s: number) => names[String(s)]?.trim() || defaultName(lang, s);
  const participants = [...new Set(tr.blocks.map((b) => label(b.speaker)))];
  const locale = t(lang, "meta.locale");
  const date = new Date(m.date).toLocaleString(locale, { dateStyle: "full", timeStyle: "short", timeZone: deps.timeZone });
  const instructions = user.minutesInstructions.trim();
  const result = await runLlm(deps, user, {
    purpose: "minutes",
    meetingId: m.id,
    provider,
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
  // A new version each time, so different models can be compared side by side.
  await deps.store.addMinutes(m.id, { body: result.text, provider: result.provider, model: result.model }, deps.now());
  return (await deps.store.minutes(m.id))!;
}

/* ---------- automatic steps (docs/design/automatic-minutes-and-revisions.md) ---------- */

/**
 * Names after a transcription, without a click: suggestions with high or medium confidence go to
 * voices that have no name yet. The default provider is checked before the step is taken, so a
 * missing permission or key leaves it pending; once taken, it never runs again on its own.
 */
export async function autoNames(deps: MinutesDeps, user: User, meetingId: string, lang: string) {
  await pickLlm(deps, user);
  if (!(await deps.store.takeAutoStep(user.id, meetingId, "names"))) return { skipped: true as const };
  const r = await suggestSpeakers(deps, user, meetingId, lang);
  const sure = Object.fromEntries(r.suggestions.filter((s) => s.confidence !== "low").map((s) => [String(s.speaker), s.name]));
  return { ...r, applied: await deps.store.fillSpeakerNames(meetingId, sure) };
}

/** Minutes after a transcription (and its names), without a click; same rules as autoNames. */
export async function autoMinutes(deps: MinutesDeps, user: User, meetingId: string, lang: string): Promise<MinutesRow | { skipped: true }> {
  await pickLlm(deps, user);
  if (!(await deps.store.takeAutoStep(user.id, meetingId, "minutes"))) return { skipped: true as const };
  return generateMinutes(deps, user, meetingId, lang);
}

/* ---------- revising minutes on request ---------- */

export const MAX_REQUEST = 2000;

/** A model's Markdown without a code fence around all of it. */
export function cleanMarkdown(text: string): string {
  const s = text.trim();
  const fenced = /^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i.exec(s);
  return (fenced ? fenced[1]! : s).trim();
}

/**
 * Changes a version of the minutes as the person asks ("add that Ana presents it on Friday"), all
 * of it or one part (a section, as the app shows it). The model gets the transcript to check facts.
 * The change can be undone; it is refused if the minutes changed meanwhile.
 */
export async function reviseMinutes(
  deps: MinutesDeps,
  user: User,
  meetingId: string,
  versionId: number,
  lang: string,
  req: { instruction?: unknown; part?: unknown; provider?: unknown },
): Promise<MinutesRow> {
  const instruction = typeof req.instruction === "string" ? req.instruction.trim() : "";
  if (!instruction || instruction.length > MAX_REQUEST) throw new MinutesError("invalid_instruction", 400);
  if (req.part !== undefined && (typeof req.part !== "string" || !req.part.trim())) throw new MinutesError("invalid_instruction", 400);
  const part = req.part as string | undefined;
  const { m, tr, names } = await transcribed(deps, user, meetingId);
  const current = await deps.store.minutes(m.id, versionId);
  if (!current) throw new MinutesError("not_found", 404);
  const start = part === undefined ? 0 : current.body.indexOf(part);
  if (start < 0) throw new MinutesError("minutes_changed", 409);
  const label = (s: number) => names[String(s)]?.trim() || defaultName(lang, s);
  const result = await runLlm(deps, user, {
    purpose: "revise",
    meetingId: m.id,
    provider: req.provider,
    request: {
      system: t(lang, "prompts.revise.system"),
      prompt: t(lang, part === undefined ? "prompts.revise.whole" : "prompts.revise.part", {
        title: m.title,
        participants: [...new Set(tr.blocks.map((b) => label(b.speaker)))].join(", "),
        transcript: transcriptLines(tr, label),
        minutes: current.body,
        part: part?.trim() ?? "",
        request: instruction,
      }),
      maxTokens: 16000,
      effort: part === undefined ? "medium" : "low",
    },
  });
  let text = cleanMarkdown(result.text);
  let body = text;
  if (part !== undefined) {
    // Only the part comes back: keep its heading if the model dropped it, and the spacing around it.
    const heading = part.trim().split("\n")[0]!;
    if (/^#{1,6}\s/.test(heading) && !/^#{1,6}\s/.test(text)) text = `${heading}\n\n${text}`;
    const lead = /^\s*/.exec(part)![0];
    const trail = /\s*$/.exec(part)![0];
    body = current.body.slice(0, start) + lead + text + trail + current.body.slice(start + part.length);
  }
  const outcome = await deps.store.editMinutes(m.id, current.id, body, deps.now(), { revisedWith: result.provider, expected: current.body });
  if (outcome === "not_found") throw new MinutesError("not_found", 404);
  if (outcome === "changed") throw new MinutesError("minutes_changed", 409);
  return (await deps.store.minutes(m.id, current.id))!;
}
