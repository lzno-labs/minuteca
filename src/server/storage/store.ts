// Every SQL statement of minuteca, on top of the Db interface (SQLite or D1).
import type { Db } from "./db.ts";
import { isProvider, type Provider, type Transcript } from "../transcriber/transcriber.ts";

export type Role = "admin" | "member" | "removed";

export interface User {
  id: string;
  email: string;
  role: Role;
  added_by: string | null;
  created_at: number;
  provider: Provider;
  consents: Provider[];
}

/** converting: the provider answered; the answer waits for the browser to turn it into a transcript. */
export type MeetingStatus = "created" | "uploaded" | "transcribing" | "converting" | "done" | "error";

export interface MeetingRow {
  id: string;
  user_id: string;
  title: string;
  date: string;
  source: string;
  status: MeetingStatus;
  error: string | null;
  duration: number;
  language: string | null;
  speaker_names: string;
  audio_key: string | null;
  audio_type: string | null;
  audio_bytes: number | null;
  provider: string | null;
  key_source: string | null;
  job_id: string | null;
  job_token_hash: string | null;
  job_started_at: number | null;
  usage_id: number | null;
  created_at: number;
  expires_at: number;
}

export type KeySource = "own" | "hosted";

const DAY = 86_400_000;
export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

function userFrom(row: Record<string, unknown> | null): User | null {
  if (!row) return null;
  let consents: Provider[] = [];
  try {
    consents = (JSON.parse(String(row.consents ?? "[]")) as unknown[]).filter(isProvider);
  } catch {
    consents = [];
  }
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role === "admin" || row.role === "member" ? row.role : "removed",
    added_by: (row.added_by as string) ?? null,
    created_at: Number(row.created_at),
    provider: isProvider(row.provider) ? row.provider : "deepgram",
    consents,
  };
}

export class Store {
  db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  /* ---------- access list ---------- */

  async userByEmail(email: string) {
    return userFrom(await this.db.first("SELECT * FROM users WHERE email = ?", [email]));
  }
  async userById(id: string) {
    return userFrom(await this.db.first("SELECT * FROM users WHERE id = ?", [id]));
  }
  async listUsers() {
    return (await this.db.all("SELECT * FROM users WHERE role != 'removed' ORDER BY email")).map((r) => userFrom(r)!);
  }
  /** Adds or changes a person on the access list. */
  async saveUser(email: string, role: Role, addedBy: string | null, now: number): Promise<User> {
    const existing = await this.userByEmail(email);
    if (existing) {
      await this.db.run("UPDATE users SET role = ? WHERE id = ?", [role, existing.id]);
      return { ...existing, role };
    }
    const id = crypto.randomUUID();
    await this.db.run("INSERT INTO users (id, email, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)", [id, email, role, addedBy, now]);
    return (await this.userById(id))!;
  }
  /**
   * Takes a person off the access list: they cannot sign in and their sessions end. Their meetings
   * stay until they expire (deleting someone's data is not an admin shortcut).
   */
  async removeUser(id: string) {
    await this.db.batch([
      { sql: "UPDATE users SET role = 'removed' WHERE id = ?", params: [id] },
      { sql: "DELETE FROM sessions WHERE user_id = ?", params: [id] },
    ]);
  }
  async setProvider(userId: string, provider: Provider) {
    await this.db.run("UPDATE users SET provider = ? WHERE id = ?", [provider, userId]);
  }
  async setConsents(userId: string, consents: Provider[]) {
    await this.db.run("UPDATE users SET consents = ? WHERE id = ?", [JSON.stringify([...new Set(consents)]), userId]);
  }

  /* ---------- sign in ---------- */

  async addLoginToken(hash: string, email: string, client: "web" | "app", challenge: string | null, expiresAt: number) {
    await this.db.run("INSERT INTO login_tokens (token_hash, email, client, challenge, expires_at) VALUES (?, ?, ?, ?, ?)", [hash, email, client, challenge, expiresAt]);
  }
  /** Single use: the row is deleted whether it is still valid or not. */
  async takeLoginToken(hash: string, now: number) {
    const row = await this.db.first<{ email: string; client: "web" | "app"; challenge: string | null; expires_at: number }>(
      "SELECT email, client, challenge, expires_at FROM login_tokens WHERE token_hash = ?",
      [hash],
    );
    if (!row) return null;
    const { changes } = await this.db.run("DELETE FROM login_tokens WHERE token_hash = ?", [hash]);
    if (!changes || row.expires_at < now) return null;
    return row;
  }
  async addSession(hash: string, userId: string, kind: "web" | "app", now: number, expiresAt: number) {
    await this.db.run("INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [hash, userId, kind, now, expiresAt]);
  }
  async sessionUser(hash: string, now: number) {
    const row = await this.db.first(
      "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.role != 'removed'",
      [hash, now],
    );
    return userFrom(row);
  }
  async deleteSession(hash: string) {
    await this.db.run("DELETE FROM sessions WHERE token_hash = ?", [hash]);
  }

  /* ---------- meetings ---------- */

  async meeting(userId: string, id: string) {
    return this.db.first<MeetingRow>("SELECT * FROM meetings WHERE id = ? AND user_id = ?", [id, userId]);
  }
  async meetingById(id: string) {
    return this.db.first<MeetingRow>("SELECT * FROM meetings WHERE id = ?", [id]);
  }
  async listMeetings(userId: string) {
    return this.db.all<MeetingRow>("SELECT * FROM meetings WHERE user_id = ? ORDER BY date DESC", [userId]);
  }
  async createMeeting(m: { id: string; userId: string; title: string; date: string; source: string; duration: number; now: number; retentionDays: number }) {
    await this.db.run(
      "INSERT INTO meetings (id, user_id, title, date, source, duration, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [m.id, m.userId, m.title, m.date, m.source, m.duration, m.now, m.now + m.retentionDays * DAY],
    );
  }
  async updateMeeting(userId: string, id: string, changes: { title?: string; speakerNames?: Record<string, string> }) {
    if (changes.title !== undefined) await this.db.run("UPDATE meetings SET title = ? WHERE id = ? AND user_id = ?", [changes.title, id, userId]);
    if (changes.speakerNames !== undefined) {
      await this.db.run("UPDATE meetings SET speaker_names = ? WHERE id = ? AND user_id = ?", [JSON.stringify(changes.speakerNames), id, userId]);
    }
  }
  /** Audio can be (re)placed only before a transcription starts. */
  async setAudio(userId: string, id: string, key: string, type: string, bytes: number, duration: number | null) {
    const { changes } = await this.db.run(
      `UPDATE meetings SET audio_key = ?, audio_type = ?, audio_bytes = ?, duration = COALESCE(?, duration),
         status = CASE WHEN status IN ('created', 'uploaded') THEN 'uploaded' ELSE status END
       WHERE id = ? AND user_id = ?`,
      [key, type, bytes, duration, id, userId],
    );
    return changes > 0;
  }
  async clearAudio(userId: string, id: string) {
    await this.db.run("UPDATE meetings SET audio_key = NULL, audio_type = NULL, audio_bytes = NULL WHERE id = ? AND user_id = ?", [id, userId]);
  }
  async deleteMeeting(userId: string, id: string) {
    await this.db.batch([
      { sql: "DELETE FROM transcripts WHERE meeting_id IN (SELECT id FROM meetings WHERE id = ? AND user_id = ?)", params: [id, userId] },
      { sql: "DELETE FROM meetings WHERE id = ? AND user_id = ?", params: [id, userId] },
    ]);
  }
  /** The stored transcript as JSON text, without parsing it (cheap on CPU-limited hosts). */
  async transcriptText(meetingId: string): Promise<string | null> {
    return (await this.db.first<{ body: string }>("SELECT body FROM transcripts WHERE meeting_id = ?", [meetingId]))?.body ?? null;
  }
  async transcript(meetingId: string): Promise<Transcript | null> {
    const row = await this.db.first<{ body: string }>("SELECT body FROM transcripts WHERE meeting_id = ?", [meetingId]);
    return row ? (JSON.parse(row.body) as Transcript) : null;
  }
  async saveTranscript(meetingId: string, t: Transcript) {
    await this.db.run("INSERT INTO transcripts (meeting_id, body) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET body = excluded.body", [meetingId, JSON.stringify(t)]);
  }
  async expiredMeetings(now: number, limit = 100) {
    return this.db.all<MeetingRow>("SELECT * FROM meetings WHERE expires_at <= ? LIMIT ?", [now, limit]);
  }
  async meetingsInStatus(status: MeetingStatus, limit = 50) {
    return this.db.all<MeetingRow>("SELECT * FROM meetings WHERE status = ? ORDER BY job_started_at LIMIT ?", [status, limit]);
  }
  async purgeTokens(now: number) {
    await this.db.batch([
      { sql: "DELETE FROM login_tokens WHERE expires_at < ?", params: [now] },
      { sql: "DELETE FROM sessions WHERE expires_at < ?", params: [now] },
    ]);
  }

  /* ---------- jobs ---------- */

  /** Moves a meeting to 'transcribing' only from 'uploaded' or 'error', so two clicks never pay twice. */
  async claimForTranscription(userId: string, id: string, provider: Provider, keySource: KeySource, tokenHash: string, language: string | null, now: number) {
    const { changes } = await this.db.run(
      `UPDATE meetings SET status = 'transcribing', error = NULL, provider = ?, key_source = ?, job_id = NULL, job_token_hash = ?, job_started_at = ?, language = ?
       WHERE id = ? AND user_id = ? AND status IN ('uploaded', 'error') AND audio_key IS NOT NULL`,
      [provider, keySource, tokenHash, now, language, id, userId],
    );
    return changes > 0;
  }
  /** The provider's raw answer is stored; the job token stops working. */
  async setConverting(id: string, jobId: string | null) {
    await this.db.run("UPDATE meetings SET status = 'converting', job_id = COALESCE(?, job_id), job_token_hash = NULL WHERE id = ? AND status = 'transcribing'", [jobId, id]);
  }
  async setJob(id: string, jobId: string, usageId: number | null) {
    await this.db.run("UPDATE meetings SET job_id = ?, usage_id = ? WHERE id = ?", [jobId, usageId, id]);
  }
  async setUsageId(id: string, usageId: number) {
    await this.db.run("UPDATE meetings SET usage_id = ? WHERE id = ?", [usageId, id]);
  }
  async finishMeeting(id: string, t: Transcript) {
    await this.db.batch([
      { sql: "INSERT INTO transcripts (meeting_id, body) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET body = excluded.body", params: [id, JSON.stringify(t)] },
      {
        sql: "UPDATE meetings SET status = 'done', error = NULL, duration = ?, language = ?, job_token_hash = NULL WHERE id = ? AND status IN ('transcribing', 'converting')",
        params: [t.duration, t.language, id],
      },
    ]);
  }
  async failMeeting(id: string, error: string) {
    await this.db.run("UPDATE meetings SET status = 'error', error = ?, job_token_hash = NULL WHERE id = ? AND status IN ('transcribing', 'converting')", [error, id]);
  }

  /* ---------- provider keys ---------- */

  async providerKeys(userId: string) {
    return this.db.all<{ provider: string; last4: string; created_at: number }>("SELECT provider, last4, created_at FROM provider_keys WHERE user_id = ? ORDER BY provider", [userId]);
  }
  async sealedKey(userId: string, provider: Provider) {
    return this.db.first<{ ciphertext: string; iv: string }>("SELECT ciphertext, iv FROM provider_keys WHERE user_id = ? AND provider = ?", [userId, provider]);
  }
  async saveProviderKey(userId: string, provider: Provider, k: { ciphertext: string; iv: string; last4: string; version: number }, now: number) {
    await this.db.run(
      `INSERT INTO provider_keys (user_id, provider, ciphertext, iv, last4, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, last4 = excluded.last4, version = excluded.version, created_at = excluded.created_at`,
      [userId, provider, k.ciphertext, k.iv, k.last4, k.version, now],
    );
  }
  async deleteProviderKey(userId: string, provider: Provider) {
    await this.db.run("DELETE FROM provider_keys WHERE user_id = ? AND provider = ?", [userId, provider]);
  }

  /* ---------- usage ledger ---------- */

  async addUsage(u: { userId: string; meetingId: string; provider: Provider; keySource: KeySource; seconds: number; now: number }) {
    const row = await this.db.first<{ id: number }>(
      "INSERT INTO usage (user_id, meeting_id, provider, key_source, month, seconds, final, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) RETURNING id",
      [u.userId, u.meetingId, u.provider, u.keySource, monthOf(u.now), u.seconds, u.now],
    );
    return row!.id;
  }
  async finalizeUsage(id: number, seconds: number) {
    await this.db.run("UPDATE usage SET seconds = ?, final = 1 WHERE id = ?", [seconds, id]);
  }
  async dropUsage(id: number) {
    await this.db.run("DELETE FROM usage WHERE id = ? AND final = 0", [id]);
  }
  async usedSeconds(month: string, keySource: KeySource, userId?: string) {
    const row = userId
      ? await this.db.first<{ s: number | null }>("SELECT SUM(seconds) AS s FROM usage WHERE month = ? AND key_source = ? AND user_id = ?", [month, keySource, userId])
      : await this.db.first<{ s: number | null }>("SELECT SUM(seconds) AS s FROM usage WHERE month = ? AND key_source = ?", [month, keySource]);
    return Number(row?.s ?? 0);
  }
  async usageOf(userId: string) {
    return this.db.all<{ month: string; provider: string; key_source: string; seconds: number }>(
      "SELECT month, provider, key_source, SUM(seconds) AS seconds FROM usage WHERE user_id = ? GROUP BY month, provider, key_source ORDER BY month DESC",
      [userId],
    );
  }
  async purgeUsage(beforeMonth: string) {
    await this.db.run("DELETE FROM usage WHERE month < ?", [beforeMonth]);
  }
}
