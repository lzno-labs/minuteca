// OpenAI adapter (https://platform.openai.com/docs/api-reference/audio/createTranscription), with the
// diarizing model. Synchronous, and OpenAI accepts files of up to 25 MB.
import { bytesOf, call, errorFor, ProviderError, round, speakerIndexer, type Block, type Fetcher, type Transcriber, type Transcript } from "./transcriber.ts";

const API = "https://api.openai.com/v1";
export const OPENAI_MODEL = "gpt-4o-transcribe-diarize";
export const OPENAI_MAX_BYTES = 25 * 1024 * 1024;

const EXT: Record<string, string> = { "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "video/webm": "webm", "video/mp4": "mp4", "audio/flac": "flac" };

export function openai(fetcher: Fetcher = fetch): Transcriber {
  return {
    provider: "openai",
    maxBytes: OPENAI_MAX_BYTES,
    async start(audio, { apiKey, language }) {
      if (audio.size > OPENAI_MAX_BYTES) throw new ProviderError("too_large", "openai accepts files of up to 25 MB");
      const type = audio.contentType.split(";")[0]!;
      const form = new FormData();
      form.set("file", new Blob([(await audio.bytes()) as BlobPart], { type }), `audio.${EXT[type] ?? "webm"}`);
      form.set("model", OPENAI_MODEL);
      form.set("response_format", "diarized_json");
      form.set("chunking_strategy", "auto");
      if (language) form.set("language", language);
      const r = await call("openai", fetcher, `${API}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      if (!r.ok) throw errorFor("openai", r.status);
      return { status: "done", raw: await bytesOf(r) };
    },
    fromRaw: (raw, language) => fromOpenai(raw, language),
    async checkKey(apiKey) {
      const r = await call("openai", fetcher, `${API}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, 15_000);
      if (r.status === 401 || r.status === 403) return false;
      if (!r.ok) throw errorFor("openai", r.status);
      return true;
    },
  };
}

export function fromOpenai(j: any, language?: string): Transcript {
  const index = speakerIndexer();
  const segments = Array.isArray(j?.segments) ? j.segments : [];
  const blocks: Block[] = [];
  for (const s of segments) {
    const text = String(s.text ?? "").trim();
    if (!text) continue;
    const speaker = index(s.speaker);
    const last = blocks[blocks.length - 1];
    // Consecutive segments of the same voice become one block, like the other providers.
    if (last && last.speaker === speaker && round(s.start) - last.end < 2) {
      last.text += ` ${text}`;
      last.end = round(s.end);
    } else blocks.push({ speaker, start: round(s.start), end: round(s.end), text });
  }
  const lastEnd = blocks.length ? blocks[blocks.length - 1]!.end : 0;
  return {
    format: "minuteca-transcript",
    version: 1,
    provider: "openai",
    model: OPENAI_MODEL,
    language: j?.language ?? language ?? null,
    duration: round(j?.duration ?? j?.usage?.seconds ?? lastEnd),
    blocks,
  };
}
