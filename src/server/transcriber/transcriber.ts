/**
 * The transcriber boundary and minuteca's own transcript format (docs/adr/0002-transcripts-and-providers.md).
 * Every provider is an adapter that turns its answer into the same Transcript, so the rest of
 * the app never knows which one ran. Adding a provider is adding an adapter here.
 */
export const PROVIDERS = ["deepgram", "assemblyai", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const isProvider = (p: unknown): p is Provider => typeof p === "string" && (PROVIDERS as readonly string[]).includes(p);

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

/** One block of speech by one voice. Times in seconds from the start of the audio. */
export interface Block {
  speaker: number;
  start: number;
  end: number;
  text: string;
  /** Finer timings when the provider gives them (used for subtitles). */
  sentences?: Sentence[];
}

export interface Transcript {
  format: "minuteca-transcript";
  version: 1;
  provider: Provider;
  model: string;
  language: string | null;
  /** Length of the audio in seconds, as measured by the provider. */
  duration: number;
  blocks: Block[];
}

/** Where a provider gets the audio from. */
export interface AudioSource {
  /** Short-lived link the provider downloads the audio from (only when the server is reachable from the internet). */
  url?: string;
  /** The bytes, for providers or installs that cannot use a link. */
  bytes(): Promise<Uint8Array>;
  contentType: string;
  size: number;
}

export interface StartOptions {
  apiKey: string;
  /** BCP 47 code ("es", "en") or undefined to detect it. */
  language?: string;
  /** Where the provider posts the result, when it supports callbacks (servers reachable from the internet). */
  callbackUrl?: string;
}

/**
 * A finished job carries the provider's raw answer (JSON bytes). Turning it into a Transcript
 * (fromRaw) is a pure function that runs on the server, or in the browser on hosts with a
 * small CPU budget per request (docs/adr/0001-where-it-runs.md).
 */
export type JobResult =
  | { status: "done"; raw: Uint8Array; providerJobId?: string }
  | { status: "pending"; providerJobId: string }
  | { status: "failed"; error: ProviderErrorCode };

export interface Transcriber {
  provider: Provider;
  /** Largest file the provider accepts, in bytes. */
  maxBytes: number;
  start(audio: AudioSource, options: StartOptions): Promise<JobResult>;
  /** Asks for the result of a pending job (only where the provider cannot call us back). */
  poll?(jobId: string, apiKey: string): Promise<JobResult>;
  /** The provider called our callback URL with this body. */
  callback?(body: Uint8Array, apiKey: string): Promise<JobResult>;
  /** The provider's raw answer (parsed JSON) in our format. Pure: also runs in the browser. */
  fromRaw(raw: unknown, language?: string): Transcript;
  /** Removes the job and its data from the provider, when it keeps them. Best effort. */
  forget?(jobId: string, apiKey: string): Promise<void>;
  /** true if the provider accepts the key. Sends the key only to that provider. */
  checkKey(apiKey: string): Promise<boolean>;
}

export type ProviderErrorCode = "invalid_key" | "unprocessable" | "too_large" | "unavailable" | "timeout";

/** Errors carry a code the app can show; provider error bodies never reach people or logs in full. */
export class ProviderError extends Error {
  code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type Fetcher = typeof fetch;

export const round = (n: unknown): number => Math.round((Number(n) || 0) * 1000) / 1000;

/** Maps a provider's speaker labels ("A", "B", 0, 1...) to 0, 1, 2... in order of appearance. */
export function speakerIndexer(): (label: unknown) => number {
  const seen = new Map<string, number>();
  return (label) => {
    const key = String(label ?? "0");
    if (!seen.has(key)) seen.set(key, seen.size);
    return seen.get(key)!;
  };
}

/** Status of a failed provider call, mapped to our codes. Never includes the provider's body. */
export function errorFor(provider: Provider, status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("invalid_key", `${provider} rejected the key (${status})`);
  if (status === 413) return new ProviderError("too_large", `${provider}: file too large`);
  if (status >= 400 && status < 500 && status !== 429) return new ProviderError("unprocessable", `${provider} could not process the audio (${status})`);
  return new ProviderError("unavailable", `${provider} answered ${status}`);
}

export async function call(provider: Provider, fetcher: Fetcher, url: string, init: RequestInit, timeoutMs = 600_000): Promise<Response> {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new ProviderError("timeout", `${provider} timed out`);
    throw new ProviderError("unavailable", `could not reach ${provider}`);
  }
}

/** Basic validation of a stored or received transcript. */
export function isTranscript(t: unknown): t is Transcript {
  const x = t as Transcript;
  return Boolean(x) && x.format === "minuteca-transcript" && x.version === 1 && Array.isArray(x.blocks) &&
    x.blocks.every((b) => Number.isInteger(b.speaker) && b.speaker >= 0 && typeof b.text === "string" && Number.isFinite(b.start) && Number.isFinite(b.end));
}

/** Block edits from the app: only the speaker of a block can change, never the text or times. */
export function withSpeakers(t: Transcript, speakers: unknown): Transcript | null {
  if (!Array.isArray(speakers) || speakers.length !== t.blocks.length) return null;
  if (!speakers.every((s) => Number.isInteger(s) && s >= 0 && s < 100)) return null;
  return { ...t, blocks: t.blocks.map((b, i) => ({ ...b, speaker: speakers[i] as number })) };
}

export const bytesOf = async (r: Response): Promise<Uint8Array> => new Uint8Array(await r.arrayBuffer());
export const parseRaw = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(raw));
