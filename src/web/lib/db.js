import Dexie from "dexie";

/**
 * On-device storage (IndexedDB). Meetings live on the server (see cloud.js);
 * this database only keeps the recording in progress, so a crash or a reload never loses it:
 *
 * sessions: in-progress / unfinalized recordings (crash-recovery staging)
 *   { id, startedAt, updatedAt, mimeType, status, elapsedMs, chunkCount }
 * chunks: 5-second MediaRecorder slices belonging to a session
 *   { id (auto), sessionId, seq, blob }
 *
 * meetings / meetingData are unused tables kept so the schema version stays
 * readable by browsers that opened older builds.
 */
export const db = new Dexie("minuteca");

db.version(1).stores({
  meetings: "id, date",
  meetingData: "id",
  sessions: "id, status, startedAt",
  chunks: "++id, sessionId, [sessionId+seq]",
});

export const SESSION_STATUS = {
  RECORDING: "recording",
  PAUSED: "paused",
  STOPPED: "stopped", // recording finished, not yet transcribed and saved
};

/** Rebuilds the full audio file for a staged session from its chunks. */
export async function assembleSessionAudio(sessionId) {
  const session = await db.sessions.get(sessionId);
  const chunks = await db.chunks
    .where("[sessionId+seq]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .toArray();
  const mimeType = session?.mimeType || chunks[0]?.blob?.type || "audio/webm";
  return {
    blob: new Blob(
      chunks.map((c) => c.blob),
      { type: mimeType },
    ),
    mimeType,
    durationSec: Math.round((session?.elapsedMs || 0) / 1000),
    startedAt: session?.startedAt,
    chunkCount: chunks.length,
  };
}

export async function deleteSession(sessionId) {
  await db.transaction("rw", db.sessions, db.chunks, async () => {
    await db.chunks.where("sessionId").equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

/** Sessions left behind by a crash, refresh, or failed transcription. */
export async function findUnfinalizedSessions() {
  const sessions = await db.sessions.orderBy("startedAt").reverse().toArray();
  const out = [];
  for (const s of sessions) {
    const count = await db.chunks.where("sessionId").equals(s.id).count();
    if (count === 0) {
      await db.sessions.delete(s.id);
    } else {
      out.push({ ...s, chunkCount: count });
    }
  }
  return out;
}

/** Best-effort request so the browser does not evict recordings under disk pressure. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not supported; IndexedDB still works, just evictable.
  }
}
