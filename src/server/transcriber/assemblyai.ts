// AssemblyAI adapter (https://www.assemblyai.com/docs/api-reference/transcripts). Asynchronous:
// start submits the job; AssemblyAI calls our webhook when it is done (or poll asks, for servers
// it cannot reach); forget deletes it from AssemblyAI once we have it.
import { bytesOf, call, errorFor, parseRaw, ProviderError, round, speakerIndexer, type Fetcher, type JobResult, type Transcriber, type Transcript } from "./transcriber.ts";

const API = "https://api.assemblyai.com/v2";
export const ASSEMBLYAI_MODEL = "universal";

export function assemblyai(fetcher: Fetcher = fetch): Transcriber {
  const headers = (apiKey: string) => ({ Authorization: apiKey, "Content-Type": "application/json" });
  return {
    provider: "assemblyai",
    maxBytes: 2 * 1024 ** 3,
    async start(audio, { apiKey, language, callbackUrl }) {
      let audioUrl = audio.url;
      if (!audioUrl) {
        const up = await call("assemblyai", fetcher, `${API}/upload`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/octet-stream" },
          body: (await audio.bytes()) as BodyInit,
        });
        if (!up.ok) throw errorFor("assemblyai", up.status);
        audioUrl = String(((await up.json()) as { upload_url?: string }).upload_url ?? "");
      }
      const body: Record<string, unknown> = { audio_url: audioUrl, speaker_labels: true, speech_model: ASSEMBLYAI_MODEL };
      if (language) body.language_code = language;
      else body.language_detection = true;
      if (callbackUrl) body.webhook_url = callbackUrl;
      const r = await call("assemblyai", fetcher, `${API}/transcript`, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body) });
      if (!r.ok) throw errorFor("assemblyai", r.status);
      const id = String(((await r.json()) as { id?: string }).id ?? "");
      if (!id) throw new ProviderError("unavailable", "assemblyai did not return a job id");
      return { status: "pending", providerJobId: id };
    },
    async poll(jobId, apiKey): Promise<JobResult> {
      const r = await call("assemblyai", fetcher, `${API}/transcript/${encodeURIComponent(jobId)}`, { headers: headers(apiKey) }, 60_000);
      if (!r.ok) throw errorFor("assemblyai", r.status);
      const raw = await bytesOf(r);
      const status = (parseRaw(raw) as { status?: string }).status;
      if (status === "error") return { status: "failed", error: "unprocessable" };
      if (status !== "completed") return { status: "pending", providerJobId: jobId };
      return { status: "done", providerJobId: jobId, raw };
    },
    /** The webhook body is small: { transcript_id, status }. The transcript itself is fetched as is. */
    async callback(body, apiKey): Promise<JobResult> {
      const j = parseRaw(body) as { transcript_id?: string; status?: string };
      const id = String(j.transcript_id ?? "");
      if (j.status === "error") return { status: "failed", error: "unprocessable" };
      if (j.status !== "completed" || !id) return { status: "pending", providerJobId: id };
      const r = await call("assemblyai", fetcher, `${API}/transcript/${encodeURIComponent(id)}`, { headers: headers(apiKey) }, 60_000);
      if (!r.ok) throw errorFor("assemblyai", r.status);
      return { status: "done", providerJobId: id, raw: await bytesOf(r) };
    },
    fromRaw: (raw) => fromAssemblyai(raw),
    async forget(jobId, apiKey) {
      await call("assemblyai", fetcher, `${API}/transcript/${encodeURIComponent(jobId)}`, { method: "DELETE", headers: headers(apiKey) }, 15_000).catch(() => {});
    },
    async checkKey(apiKey) {
      const r = await call("assemblyai", fetcher, `${API}/transcript?limit=1`, { headers: headers(apiKey) }, 15_000);
      if (r.status === 401 || r.status === 403) return false;
      if (!r.ok) throw errorFor("assemblyai", r.status);
      return true;
    },
  };
}

export function fromAssemblyai(j: any): Transcript {
  const index = speakerIndexer();
  const ms = (v: unknown) => round((Number(v) || 0) / 1000);
  const utterances = Array.isArray(j?.utterances) ? j.utterances : [];
  return {
    format: "minuteca-transcript" as const,
    version: 1 as const,
    provider: "assemblyai" as const,
    model: String(j?.speech_model ?? ASSEMBLYAI_MODEL),
    language: j?.language_code ?? null,
    duration: round(j?.audio_duration),
    blocks: utterances
      .map((u: any) => ({ speaker: index(u.speaker), start: ms(u.start), end: ms(u.end), text: String(u.text ?? "").trim() }))
      .filter((b: { text: string }) => b.text),
  };
}
