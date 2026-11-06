// Deepgram adapter (https://developers.deepgram.com/reference/listen-file).
import { bytesOf, call, errorFor, ProviderError, round, type Block, type Fetcher, type Transcriber, type Transcript } from "./transcriber.ts";

const API = "https://api.deepgram.com/v1";
export const DEEPGRAM_MODEL = "nova-3";

export function deepgramParams(language?: string, callbackUrl?: string): URLSearchParams {
  const p = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    diarize: "true",
    smart_format: "true",
    punctuate: "true",
    paragraphs: "true",
    // Do not let Deepgram use this audio to improve its models (docs/adr/0002-transcripts-and-providers.md).
    mip_opt_out: "true",
  });
  if (language) p.set("language", language);
  else p.set("detect_language", "true");
  if (callbackUrl) p.set("callback", callbackUrl);
  return p;
}

export function deepgram(fetcher: Fetcher = fetch): Transcriber {
  return {
    provider: "deepgram",
    maxBytes: 2 * 1024 ** 3,
    async start(audio, { apiKey, language, callbackUrl }) {
      const useUrl = Boolean(audio.url);
      const r = await call("deepgram", fetcher, `${API}/listen?${deepgramParams(language, useUrl ? callbackUrl : undefined)}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": useUrl ? "application/json" : audio.contentType.split(";")[0]!,
        },
        body: useUrl ? JSON.stringify({ url: audio.url }) : ((await audio.bytes()) as BodyInit),
      });
      if (!r.ok) throw errorFor("deepgram", r.status);
      if (useUrl && callbackUrl) {
        const id = String(((await r.json()) as { request_id?: string }).request_id ?? "");
        if (!id) throw new ProviderError("unavailable", "deepgram did not return a request id");
        return { status: "pending", providerJobId: id };
      }
      return { status: "done", raw: await bytesOf(r) };
    },
    // Deepgram posts the same body the synchronous call returns.
    callback: async (body) => ({ status: "done", raw: body }),
    fromRaw: (raw) => fromDeepgram(raw),
    async checkKey(apiKey) {
      const r = await call("deepgram", fetcher, `${API}/projects`, { headers: { Authorization: `Token ${apiKey}` } }, 15_000);
      if (r.status === 401 || r.status === 403) return false;
      if (!r.ok) throw errorFor("deepgram", r.status);
      return true;
    },
  };
}

/**
 * Deepgram answer to our format. Paragraphs are preferred because Deepgram already splits them
 * on speaker changes and long pauses; utterances (if present) and raw words are coarser fallbacks.
 */
export function fromDeepgram(result: unknown): Transcript {
  const r = result as any;
  const channel = r?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  return {
    format: "minuteca-transcript",
    version: 1,
    provider: "deepgram",
    model: String(r?.metadata?.model_info ? Object.values(r.metadata.model_info as Record<string, { name?: string }>)[0]?.name ?? DEEPGRAM_MODEL : DEEPGRAM_MODEL),
    language: channel?.detected_language ?? null,
    duration: round(r?.metadata?.duration),
    blocks: deepgramBlocks(alt, r?.results?.utterances),
  };
}

function speaker(v: unknown): number {
  return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0;
}

function deepgramBlocks(alt: any, utterances: any): Block[] {
  const paragraphs = alt?.paragraphs?.paragraphs;
  if (Array.isArray(paragraphs) && paragraphs.length) {
    return paragraphs
      .map((p) => {
        const sentences = (Array.isArray(p.sentences) ? p.sentences : [])
          .map((s: any) => ({ start: round(s.start), end: round(s.end), text: String(s.text ?? "").trim() }))
          .filter((s: { text: string }) => s.text);
        return { speaker: speaker(p.speaker), start: round(p.start), end: round(p.end), text: sentences.map((s: { text: string }) => s.text).join(" "), sentences };
      })
      .filter((b) => b.text);
  }
  if (Array.isArray(utterances) && utterances.length) {
    return utterances
      .map((u) => ({ speaker: speaker(u.speaker), start: round(u.start), end: round(u.end), text: String(u.transcript ?? "").trim() }))
      .filter((b) => b.text);
  }
  const out: Block[] = [];
  for (const w of Array.isArray(alt?.words) ? alt.words : []) {
    const s = speaker(w.speaker);
    const text = String(w.punctuated_word || w.word || "");
    const last = out[out.length - 1];
    if (last && last.speaker === s && w.start - last.end < 2) {
      last.text += ` ${text}`;
      last.end = round(w.end);
    } else out.push({ speaker: s, start: round(w.start), end: round(w.end), text });
  }
  return out;
}
