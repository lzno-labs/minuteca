/**
 * Upload of a recording or an imported file to the server. Transcribing is a separate step
 * (startTranscription in cloud.js), always after the person knows where the audio goes.
 */
import { ApiError, uploadFile } from "./api";
import { createMeeting } from "./cloud";

/**
 * Creates the meeting (idempotent: a retry with the same id finds it) and uploads its audio.
 * Resolves with the meeting as the server has it.
 * @param {Blob} blob
 * @param {{ id: string, title: string, date: string, source: "web" | "import", duration?: number }} meeting
 */
export async function uploadMeeting(blob, meeting, { maxBytes, onProgress, signal } = {}) {
  if (!blob.size) throw new ApiError("empty", 400);
  if (maxBytes && blob.size > maxBytes) throw new ApiError("too_large", 413);
  const created = await createMeeting(meeting);
  if (created.hasAudio && created.audioBytes === blob.size) {
    onProgress?.(1);
    return created;
  }
  const headers = meeting.duration ? { "X-Audio-Duration": String(Math.round(meeting.duration)) } : {};
  return uploadFile(`/meetings/${meeting.id}/audio`, blob, { onProgress, signal, headers });
}

/** Length of an audio file in seconds, read by the browser (0 if it cannot tell within 5 s). */
export function audioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (value) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    const timer = setTimeout(() => done(0), 5000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}
