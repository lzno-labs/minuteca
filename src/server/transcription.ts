/**
 * Transcription jobs, and the one place where money is spent on AI: every AI call goes through a
 * single function that counts and stops at the cap.
 *
 * startTranscription() is that function. It checks consent, picks the key (the person's own,
 * or the hosted keys within the monthly cap), books the expected minutes in the usage ledger
 * before calling the provider, and settles them with the real length afterwards.
 */
import { randomToken, sha256Hex } from "./crypto.ts";
import { rawKey, readAll, type Files } from "./files/files.ts";
import type { KeyVault } from "./keys.ts";
import { monthOf, type KeySource, type MeetingRow, type Store, type User } from "./storage/store.ts";
import { parseRaw, ProviderError, type AudioSource, type JobResult, type Provider, type Transcriber, type Transcript } from "./transcriber/transcriber.ts";

export interface HostedKeys {
  /** The hosted key for a provider, if there is one. */
  key(provider: Provider): string | undefined;
  /** Whether this person may use the hosted keys. */
  allowed(user: User): boolean;
  /** Cap for all hosted transcriptions together, per calendar month (UTC). */
  monthlyCapSeconds: number;
}

export interface TranscriptionDeps {
  store: Store;
  files: Files;
  vault: KeyVault | null;
  hosted: HostedKeys | null;
  transcribers: Record<Provider, Transcriber>;
  now: () => number;
  /** Public address of this server. */
  origin: string;
  /** "url": providers download the audio from a short-lived link and call us back (needs a server reachable from the internet). "upload": the server sends the bytes and asks for results. */
  providerAudio: "url" | "upload";
  /** Where a provider's answer becomes a transcript: on the server, or in the browser (hosts with a small CPU budget per request). */
  convert: "server" | "client";
}

export type TranscriptionErrorCode =
  | "not_found"
  | "no_audio"
  | "busy"
  | "already_done"
  | "no_consent"
  | "no_key"
  | "hosted_cap"
  | "too_large"
  | "keys_disabled";

export class TranscriptionError extends Error {
  code: TranscriptionErrorCode;
  status: number;
  constructor(code: TranscriptionErrorCode, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** Provider links and callbacks stop working after this. */
export const JOB_LINK_MS = 6 * 3600_000;
/** A job with no answer after this is marked failed, so it can be retried. */
export const JOB_TIMEOUT_MS = 60 * 60_000;

/** Seconds booked before the provider answers: the known length, or a guess from the size at 32 kbit/s. */
export function estimateSeconds(m: Pick<MeetingRow, "duration" | "audio_bytes">): number {
  if (m.duration > 0) return Math.ceil(m.duration);
  return Math.ceil(((m.audio_bytes ?? 0) * 8) / 32_000);
}

/** Which key pays for a transcription: the person's own first, then the hosted one. */
export async function resolveKey(deps: TranscriptionDeps, user: User, provider: Provider): Promise<{ apiKey: string; source: KeySource } | null> {
  const sealed = deps.vault ? await deps.store.sealedKey(user.id, provider) : null;
  if (sealed && deps.vault) return { apiKey: await deps.vault.open(user.id, provider, sealed), source: "own" };
  const hostedKey = deps.hosted?.allowed(user) ? deps.hosted.key(provider) : undefined;
  return hostedKey ? { apiKey: hostedKey, source: "hosted" } : null;
}

async function keyFor(deps: TranscriptionDeps, m: MeetingRow, provider: Provider): Promise<string | null> {
  if (m.key_source === "own") {
    const sealed = deps.vault ? await deps.store.sealedKey(m.user_id, provider) : null;
    return sealed && deps.vault ? deps.vault.open(m.user_id, provider, sealed) : null;
  }
  return deps.hosted?.key(provider) ?? null;
}

/** Hosted minutes left this month for everyone together. */
export async function hostedRemainingSeconds(deps: TranscriptionDeps): Promise<number> {
  if (!deps.hosted) return 0;
  const used = await deps.store.usedSeconds(monthOf(deps.now()), "hosted");
  return Math.max(0, deps.hosted.monthlyCapSeconds - used);
}

/** THE function every AI call goes through. Returns the meeting as it is after the call. */
export async function startTranscription(
  deps: TranscriptionDeps,
  user: User,
  meetingId: string,
  options: { provider: Provider; language?: string },
): Promise<MeetingRow> {
  const { store } = deps;
  const { provider } = options;
  const m = await store.meeting(user.id, meetingId);
  if (!m) throw new TranscriptionError("not_found", 404);
  if (!m.audio_key) throw new TranscriptionError("no_audio", 409);
  if (m.status === "transcribing") throw new TranscriptionError("busy", 409);
  if (m.status === "done") throw new TranscriptionError("already_done", 409);
  if (!user.consents.includes(provider)) throw new TranscriptionError("no_consent", 403);
  const transcriber = deps.transcribers[provider];
  if ((m.audio_bytes ?? 0) > transcriber.maxBytes) throw new TranscriptionError("too_large", 413);

  const key = await resolveKey(deps, user, provider);
  if (!key) throw new TranscriptionError("no_key", 402);
  const seconds = estimateSeconds(m);
  if (key.source === "hosted" && seconds > (await hostedRemainingSeconds(deps))) throw new TranscriptionError("hosted_cap", 429);

  const token = randomToken();
  if (!(await store.claimForTranscription(user.id, m.id, provider, key.source, await sha256Hex(token), options.language ?? null, deps.now()))) {
    throw new TranscriptionError("busy", 409);
  }
  // Book the minutes before the call, so two transcriptions at once cannot both pass the cap.
  const usageId = await store.addUsage({ userId: user.id, meetingId: m.id, provider, keySource: key.source, seconds, now: deps.now() });
  await store.setUsageId(m.id, usageId);

  const useUrl = deps.providerAudio === "url";
  const audio: AudioSource = {
    url: useUrl ? `${deps.origin}/api/provider-audio/${m.id}/${token}` : undefined,
    contentType: m.audio_type ?? "application/octet-stream",
    size: m.audio_bytes ?? 0,
    async bytes() {
      const f = await deps.files.get(m.audio_key!);
      if (!f) throw new ProviderError("unprocessable", "audio file is missing");
      return readAll(f);
    },
  };
  try {
    const result = await transcriber.start(audio, {
      apiKey: key.apiKey,
      language: options.language,
      callbackUrl: useUrl ? `${deps.origin}/api/provider-callback/${m.id}/${token}` : undefined,
    });
    await settle(deps, { ...m, usage_id: usageId, key_source: key.source, provider, language: options.language ?? null }, result);
  } catch (err) {
    await fail(deps, { ...m, usage_id: usageId }, err);
  }
  return (await store.meeting(user.id, m.id))!;
}

/** Applies a provider answer to a meeting in 'transcribing'. */
export async function settle(deps: TranscriptionDeps, m: MeetingRow, result: JobResult): Promise<void> {
  if (result.status === "pending") {
    if (result.providerJobId) await deps.store.setJob(m.id, result.providerJobId, m.usage_id);
    return;
  }
  if (result.status === "failed") {
    await fail(deps, m, new ProviderError(result.error, "provider reported a failure"));
    return;
  }
  const jobId = result.providerJobId ?? m.job_id;
  if (deps.convert === "client") {
    // Parsing a long meeting's answer takes more CPU than some hosts allow per request: keep the
    // bytes as they came and let the browser convert them (PUT /api/meetings/:id/transcript).
    await deps.files.put(rawKey(m.user_id, m.id), result.raw, "application/json", result.raw.byteLength);
    await deps.store.setConverting(m.id, jobId);
    return;
  }
  let transcript: Transcript;
  try {
    transcript = deps.transcribers[m.provider as Provider].fromRaw(parseRaw(result.raw), m.language ?? undefined);
  } catch {
    await fail(deps, m, new ProviderError("unprocessable", "unreadable provider answer"));
    return;
  }
  await finishTranscript(deps, { ...m, job_id: jobId }, transcript);
}

/**
 * Saves a transcript and settles the usage ledger. With conversion in the browser the minutes
 * booked are never lowered by what the browser reports: the larger of both counts.
 */
export async function finishTranscript(deps: TranscriptionDeps, m: MeetingRow, t: Transcript): Promise<boolean> {
  if (!t.blocks.length && !t.duration) {
    await fail(deps, m, new ProviderError("unprocessable", "empty transcript"));
    return false;
  }
  await deps.store.finishMeeting(m.id, t);
  if (m.usage_id) {
    const seconds = deps.convert === "client" ? Math.max(t.duration, estimateSeconds(m)) : t.duration || estimateSeconds(m);
    await deps.store.finalizeUsage(m.usage_id, Math.ceil(seconds));
  }
  await deps.files.delete(rawKey(m.user_id, m.id));
  const transcriber = m.provider ? deps.transcribers[m.provider as Provider] : undefined;
  if (transcriber?.forget && m.job_id) {
    const apiKey = await keyFor(deps, m, transcriber.provider);
    if (apiKey) await transcriber.forget(m.job_id, apiKey);
  }
  return true;
}

async function fail(deps: TranscriptionDeps, m: MeetingRow, err: unknown): Promise<void> {
  const code = err instanceof ProviderError ? err.code : "unavailable";
  if (!(err instanceof ProviderError)) console.error("transcription", m.id, (err as Error)?.message);
  await deps.store.failMeeting(m.id, code);
  if (m.usage_id) await deps.store.dropUsage(m.usage_id);
}

/** Checks a provider link or callback token against the meeting's current job. */
export async function jobByToken(deps: TranscriptionDeps, meetingId: string, token: string): Promise<MeetingRow | null> {
  const m = await deps.store.meetingById(meetingId);
  if (!m || m.status !== "transcribing" || !m.job_token_hash || !m.job_started_at) return null;
  if (deps.now() - m.job_started_at > JOB_LINK_MS) return null;
  return (await sha256Hex(token)) === m.job_token_hash ? m : null;
}

/** A provider called our callback URL (Deepgram with the result, AssemblyAI with a notice). */
export async function completeFromCallback(deps: TranscriptionDeps, m: MeetingRow, body: Uint8Array): Promise<void> {
  const transcriber = deps.transcribers[m.provider as Provider];
  if (!transcriber?.callback) return;
  const apiKey = await keyFor(deps, m, transcriber.provider);
  if (!apiKey) {
    await fail(deps, m, new ProviderError("invalid_key", "the key is gone"));
    return;
  }
  try {
    await settle(deps, m, await transcriber.callback(body, apiKey));
  } catch (err) {
    await fail(deps, m, err);
  }
}

/**
 * Fails jobs that never answered, and asks providers about pending jobs where they cannot call
 * us back (a server not reachable from the internet).
 */
export async function refreshJob(deps: TranscriptionDeps, m: MeetingRow): Promise<void> {
  if (m.status !== "transcribing") return;
  if (m.job_started_at && deps.now() - m.job_started_at > JOB_TIMEOUT_MS) {
    await fail(deps, m, new ProviderError("timeout", "no answer from the provider"));
    return;
  }
  const transcriber = deps.transcribers[m.provider as Provider];
  if (deps.providerAudio === "url" || !transcriber?.poll || !m.job_id) return;
  const apiKey = await keyFor(deps, m, transcriber.provider);
  if (!apiKey) {
    await fail(deps, m, new ProviderError("invalid_key", "the key is gone"));
    return;
  }
  try {
    await settle(deps, m, await transcriber.poll(m.job_id, apiKey));
  } catch (err) {
    // A failed poll is not a failed job: try again on the next refresh, until the timeout.
    if (err instanceof ProviderError && err.code === "invalid_key") await fail(deps, m, err);
  }
}
