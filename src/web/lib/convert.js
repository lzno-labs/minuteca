/**
 * Converts a provider's raw answer into minuteca's transcript format, in the browser. Used when
 * the server runs where each request has little CPU (Cloudflare Workers Free): the server keeps
 * the answer as it came and the first browser that opens the meeting converts it.
 * The converters are the same pure functions the server uses (src/server/transcriber/).
 */
import { fromDeepgram } from "../../server/transcriber/deepgram.ts";
import { fromAssemblyai } from "../../server/transcriber/assemblyai.ts";
import { fromOpenai } from "../../server/transcriber/openai.ts";
import { api, ApiError } from "./api";

const CONVERTERS = { deepgram: fromDeepgram, assemblyai: fromAssemblyai, openai: fromOpenai };

export function toTranscript(provider, raw, language) {
  const convert = CONVERTERS[provider];
  if (!convert) throw new ApiError("invalid_provider", 400);
  return convert(raw, language || undefined);
}

const running = new Map();

/** Fetches the raw answer, converts it and sends the transcript. Single-flight per meeting. */
export function convertMeeting(meeting) {
  if (!running.has(meeting.id)) {
    const job = (async () => {
      const res = await fetch(`/api/meetings/${meeting.id}/raw`, { credentials: "same-origin" });
      if (!res.ok) throw new ApiError("not_found", res.status);
      const transcript = toTranscript(meeting.provider, await res.json(), meeting.language);
      return api(`/meetings/${meeting.id}/transcript`, { method: "PUT", body: { transcript } });
    })().finally(() => running.delete(meeting.id));
    running.set(meeting.id, job);
  }
  return running.get(meeting.id);
}
