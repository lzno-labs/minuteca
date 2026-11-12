/**
 * Meetings stored on the minuteca server, so they show up on every device (and the iOS
 * recorder's uploads show up here). Everything is deleted after the retention period.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Server meeting to the shape the components use (utterances = transcript blocks). */
export function fromServer(m) {
  if (!m) return m;
  return {
    ...m,
    expiresAt: m.expiresAt ? new Date(m.expiresAt) : null,
    utterances: m.transcript?.blocks ?? [],
  };
}

const listeners = new Set();
/** Tells every open list and meeting to reload (after a change made on this page). */
export function refreshMeetings() {
  listeners.forEach((fn) => fn());
}

function useRefresh(load, intervalMs) {
  useEffect(() => {
    load();
    listeners.add(load);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), intervalMs);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      listeners.delete(load);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, intervalMs]);
}

/** The person's meetings, newest first. undefined while loading. */
export function useMeetings() {
  const [meetings, setMeetings] = useState(undefined);
  const load = useCallback(() => {
    api("/meetings")
      .then((d) => setMeetings(d.meetings.map(fromServer)))
      .catch(() => setMeetings((m) => m ?? []));
  }, []);
  // Uploads from the iPhone recorder appear within half a minute.
  useRefresh(load, 30_000);
  return meetings;
}

/**
 * One meeting with its transcript. null while loading, undefined if it does not exist (deleted or
 * expired). Reloads every few seconds while it is being transcribed.
 */
export function useMeeting(id) {
  const [meeting, setMeeting] = useState(null);
  const load = useCallback(() => {
    if (!id) return;
    api(`/meetings/${id}`)
      .then((m) => setMeeting(fromServer(m)))
      .catch((err) => err?.status === 404 && setMeeting(undefined));
  }, [id]);
  useRefresh(load, 60_000);
  const transcribing = meeting?.status === "transcribing";
  useEffect(() => {
    if (!transcribing) return undefined;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [transcribing, load]);
  return [meeting, load];
}

export const createMeeting = (meeting) => api("/meetings", { method: "POST", body: meeting });
export const updateMeetingMeta = (id, changes) => api(`/meetings/${id}`, { method: "PATCH", body: changes });
/** Saves which voice each block belongs to (the text never changes). */
export const updateSpeakers = (id, utterances) => api(`/meetings/${id}`, { method: "PATCH", body: { speakers: utterances.map((u) => u.speaker) } });
export const deleteMeeting = (id) => api(`/meetings/${id}`, { method: "DELETE" });
export const removeMeetingAudio = (id) => api(`/meetings/${id}/audio`, { method: "DELETE" });
export const startTranscription = (id, { provider, language, again } = {}) =>
  api(`/meetings/${id}/transcribe`, { method: "POST", body: { provider, language: language || undefined, again: again || undefined } });
export const audioUrl = (id) => `/api/meetings/${id}/audio`;

export async function getAudioBlob(id) {
  const res = await fetch(audioUrl(id), { credentials: "same-origin" });
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}
