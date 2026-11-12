// Every SQL statement of minuteca, on top of the Db interface (SQLite or D1).
import type { Db } from "./db.ts";
import { isProvider, type Provider, type Transcript } from "../transcriber/transcriber.ts";
import { isLlmProvider, type LlmProviderId } from "../llm/llm.ts";

export type Role = "admin" | "member" | "removed";

export interface User {
  id: string;
  email: string;
  role: Role;
  added_by: string | null;
  created_at: number;
  provider: Provider;
  /** Permissions to send data: transcription providers ("deepgram") and language models ("llm:anthropic"). */
  consents: string[];
  llmProvider: LlmProviderId | null;
  /** Model chosen per language model provider; missing means the provider's default. */
  llmModels: Partial<Record<LlmProviderId, string>>;
  minutesInstructions: string;
  /** What runs on its own once a transcription finishes (docs/design/automatic-minutes-and-revisions.md). */
  autoSteps: AutoStep[];
}

/** Steps that can run on their own after a transcription, in this order. */
export const AUTO_STEPS = ["names", "minutes"] as const;
export type AutoStep = (typeof AUTO_STEPS)[number];
export const isAutoStep = (s: unknown): s is AutoStep => AUTO_STEPS.includes(s as AutoStep);
const autoList = (v: unknown): AutoStep[] => AUTO_STEPS.filter((s) => String(v ?? "").split(",").includes(s));

export const isConsentId = (c: unknown): c is string =>
  isProvider(c) || (typeof c === "string" && c.startsWith("llm:") && isLlmProvider(c.slice(4)));

/** Earlier transcripts kept per meeting when it is transcribed again (they can be large). */
export const MAX_TRANSCRIPT_VERSIONS = 5;

export interface TranscriptVersionRow {
  id: number;
  provider: string | null;
  model: string | null;
  speaker_names: string;
  duration: number;
  archived_at: number;
}

/**
 * Statements that move a meeting's current transcript, with its voice names, into its versions
 * (only while the meeting is in one of `statuses`), keeping the newest MAX_TRANSCRIPT_VERSIONS.
 */
function archiveTranscript(id: string, now: number, statuses: string[]) {
  return [
    {
      sql: `INSERT INTO transcript_versions (meeting_id, body, provider, model, speaker_names, duration, language, archived_at)
            SELECT t.meeting_id, t.body, json_extract(t.body, '$.provider'), json_extract(t.body, '$.model'), m.speaker_names, m.duration, m.language, ?
            FROM transcripts t JOIN meetings m ON m.id = t.meeting_id WHERE t.meeting_id = ? AND m.status IN (${statuses.map(() => "?").join(", ")})`,
      params: [now, id, ...statuses],
    },
    {
      sql: "DELETE FROM transcript_versions WHERE meeting_id = ? AND id NOT IN (SELECT id FROM transcript_versions WHERE meeting_id = ? ORDER BY archived_at DESC, id DESC LIMIT ?)",
      params: [id, id, MAX_TRANSCRIPT_VERSIONS],
    },
  ];
}

/** Versions of a meeting's minutes kept, so people can compare language models. */
export const MAX_MINUTES_VERSIONS = 10;

export interface MinutesRow {
  id: number;
  body: string;
  provider: string;
  model: string;
  edited: number;
  /** The provider that last changed it on the person's request, if any. */
  revised_with: string | null;
  /** Earlier texts that "undo" can bring back. */
  undo_count: number;
  created_at: number;
  updated_at: number;
}

const MINUTES_COLUMNS = "id, body, provider, model, edited, revised_with, json_array_length(undo) AS undo_count, created_at, updated_at";

/** Earlier texts kept per minutes version for "undo", within D1's 2 MB per row. */
export const MAX_UNDO = 5;
const MAX_UNDO_CHARS = 500_000;

interface UndoEntry {
  body: string;
  edited: number;
  revised_with: string | null;
}

function undoList(json: string): UndoEntry[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((e): e is UndoEntry => typeof (e as UndoEntry)?.body === "string") : [];
  } catch {
    return [];
  }
}

export type EditOutcome = "ok" | "not_found" | "changed";

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
  /** Automatic steps still to run for the current transcript ("names,minutes"). */
  auto_pending: string;
  created_at: number;
  expires_at: number;
}

export type KeySource = "own" | "hosted";

const DAY = 86_400_000;

/** A new transcript gets the person's automatic steps; none without a default language model. */
const AUTO_PENDING = "auto_pending = COALESCE((SELECT CASE WHEN u.llm_provider IS NULL THEN '' ELSE u.auto_steps END FROM users u WHERE u.id = meetings.user_id), '')";
export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

function userFrom(row: Record<string, unknown> | null): User | null {
  if (!row) return null;
  const parse = <T,>(v: unknown, fallback: T): T => {
    try {
      return JSON.parse(String(v)) as T;
    } catch {
      return fallback;
    }
  };
  const consents = parse<unknown[]>(row.consents ?? "[]", []).filter(isConsentId);
  const models = parse<Record<string, unknown>>(row.llm_models ?? "{}", {});
  const llmModels: Partial<Record<LlmProviderId, string>> = {};
  for (const [k, v] of Object.entries(models && typeof models === "object" ? models : {})) if (isLlmProvider(k) && typeof v === "string") llmModels[k] = v;
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role === "admin" || row.role === "member" ? row.role : "removed",
    added_by: (row.added_by as string) ?? null,
    created_at: Number(row.created_at),
    provider: isProvider(row.provider) ? row.provider : "deepgram",
    consents,
    llmProvider: isLlmProvider(row.llm_provider) ? row.llm_provider : null,
    llmModels,
    minutesInstructions: String(row.minutes_instructions ?? ""),
    autoSteps: autoList(row.auto_steps),
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
  async setLlmSettings(userId: string, s: { provider: LlmProviderId | null; models: Partial<Record<LlmProviderId, string>>; instructions: string }) {
    await this.db.run("UPDATE users SET llm_provider = ?, llm_models = ?, minutes_instructions = ? WHERE id = ?", [s.provider, JSON.stringify(s.models), s.instructions, userId]);
  }
  async setAutoSteps(userId: string, steps: AutoStep[]) {
    await this.db.run("UPDATE users SET auto_steps = ? WHERE id = ?", [AUTO_STEPS.filter((s) => steps.includes(s)).join(","), userId]);
  }
  async setConsents(userId: string, consents: string[]) {
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
      { sql: "DELETE FROM minutes WHERE meeting_id IN (SELECT id FROM meetings WHERE id = ? AND user_id = ?)", params: [id, userId] },
      { sql: "DELETE FROM transcript_versions WHERE meeting_id IN (SELECT id FROM meetings WHERE id = ? AND user_id = ?)", params: [id, userId] },
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
  /** again: a meeting already transcribed may start over; its transcript is kept until the new one arrives. */
  async claimForTranscription(userId: string, id: string, provider: Provider, keySource: KeySource, tokenHash: string, language: string | null, now: number, again = false) {
    const { changes } = await this.db.run(
      `UPDATE meetings SET status = 'transcribing', error = NULL, provider = ?, key_source = ?, job_id = NULL, job_token_hash = ?, job_started_at = ?, language = ?
       WHERE id = ? AND user_id = ? AND status IN ('uploaded', 'error'${again ? ", 'done'" : ""}) AND audio_key IS NOT NULL`,
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
  /** A provider's transcript: an earlier one goes to the versions, and voice names start over. */
  async finishMeeting(id: string, t: Transcript, now: number) {
    await this.db.batch([
      ...archiveTranscript(id, now, ["transcribing", "converting"]),
      { sql: "INSERT INTO transcripts (meeting_id, body) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET body = excluded.body", params: [id, JSON.stringify(t)] },
      {
        sql: `UPDATE meetings SET status = 'done', error = NULL, duration = ?, language = ?, speaker_names = '{}', job_token_hash = NULL, ${AUTO_PENDING} WHERE id = ? AND status IN ('transcribing', 'converting')`,
        params: [t.duration, t.language, id],
      },
    ]);
  }
  /** A transcript from the desktop app: an earlier one goes to the versions, and voice names start over. */
  async finishLocal(id: string, t: Transcript, now: number) {
    await this.db.batch([
      ...archiveTranscript(id, now, ["uploaded", "error", "done"]),
      { sql: "INSERT INTO transcripts (meeting_id, body) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET body = excluded.body", params: [id, JSON.stringify(t)] },
      {
        sql: `UPDATE meetings SET status = 'done', error = NULL, provider = 'local', key_source = NULL, duration = ?, language = ?, speaker_names = '{}', job_id = NULL, job_token_hash = NULL, ${AUTO_PENDING} WHERE id = ? AND status IN ('uploaded', 'error', 'done')`,
        params: [t.duration, t.language, id],
      },
    ]);
  }
  /** A failed transcription; a meeting that had a transcript keeps it (and its provider), with the error noted. */
  async failMeeting(id: string, error: string) {
    await this.db.run(
      `UPDATE meetings SET
         status = CASE WHEN EXISTS (SELECT 1 FROM transcripts WHERE meeting_id = meetings.id) THEN 'done' ELSE 'error' END,
         provider = COALESCE((SELECT json_extract(body, '$.provider') FROM transcripts WHERE meeting_id = meetings.id), provider),
         error = ?, job_token_hash = NULL
       WHERE id = ? AND status IN ('transcribing', 'converting')`,
      [error, id],
    );
  }

  /* ---------- automatic steps ---------- */

  /** Takes one pending step of a finished meeting, once: false if it is not pending (or another tab took it). */
  async takeAutoStep(userId: string, meetingId: string, step: AutoStep): Promise<boolean> {
    const row = await this.db.first<{ auto_pending: string }>("SELECT auto_pending FROM meetings WHERE id = ? AND user_id = ? AND status = 'done'", [meetingId, userId]);
    if (!row || !autoList(row.auto_pending).includes(step)) return false;
    const rest = autoList(row.auto_pending).filter((s) => s !== step).join(",");
    const { changes } = await this.db.run("UPDATE meetings SET auto_pending = ? WHERE id = ? AND auto_pending = ?", [rest, meetingId, row.auto_pending]);
    return changes > 0;
  }
  async clearAutoSteps(userId: string, meetingId: string) {
    await this.db.run("UPDATE meetings SET auto_pending = '' WHERE id = ? AND user_id = ?", [meetingId, userId]);
  }
  /** Gives names to voices that have none yet; a name typed meanwhile wins. Returns what was applied. */
  async fillSpeakerNames(meetingId: string, names: Record<string, string>): Promise<Record<string, string>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.db.first<{ speaker_names: string }>("SELECT speaker_names FROM meetings WHERE id = ?", [meetingId]);
      if (!row) return {};
      let current: Record<string, string> = {};
      try {
        current = JSON.parse(row.speaker_names) as Record<string, string>;
      } catch {
        current = {};
      }
      const applied: Record<string, string> = {};
      for (const [k, v] of Object.entries(names)) {
        if (!current[k]?.trim()) applied[k] = v;
      }
      if (!Object.keys(applied).length) return {};
      const { changes } = await this.db.run("UPDATE meetings SET speaker_names = ? WHERE id = ? AND speaker_names = ?", [JSON.stringify({ ...current, ...applied }), meetingId, row.speaker_names]);
      if (changes) return applied;
    }
    return {};
  }

  /* ---------- earlier transcripts ---------- */

  async transcriptVersions(meetingId: string) {
    return this.db.all<TranscriptVersionRow>(
      "SELECT id, provider, model, speaker_names, duration, archived_at FROM transcript_versions WHERE meeting_id = ? ORDER BY archived_at DESC, id DESC",
      [meetingId],
    );
  }
  async transcriptVersionsText(meetingId: string): Promise<string[]> {
    return (await this.db.all<{ body: string }>("SELECT body FROM transcript_versions WHERE meeting_id = ? ORDER BY archived_at DESC, id DESC", [meetingId])).map((r) => r.body);
  }
  /** Swaps an earlier transcript back in; the current one becomes a version. Only for finished meetings. */
  async useTranscriptVersion(meetingId: string, versionId: number, now: number): Promise<boolean> {
    const v = await this.db.first<{ id: number }>("SELECT id FROM transcript_versions WHERE id = ? AND meeting_id = ?", [versionId, meetingId]);
    const m = await this.db.first<{ status: string }>("SELECT status FROM meetings WHERE id = ?", [meetingId]);
    if (!v || m?.status !== "done") return false;
    const pick = (col: string) => `(SELECT ${col} FROM transcript_versions WHERE id = ${Number(versionId)})`;
    // Archive first, prune last: pruning before the copy could drop the very version being used.
    const [archive, prune] = archiveTranscript(meetingId, now, ["done"]);
    await this.db.batch([
      archive!,
      {
        sql: "INSERT INTO transcripts (meeting_id, body) SELECT meeting_id, body FROM transcript_versions WHERE id = ? AND meeting_id = ? ON CONFLICT(meeting_id) DO UPDATE SET body = excluded.body",
        params: [versionId, meetingId],
      },
      {
        sql: `UPDATE meetings SET provider = ${pick("provider")}, speaker_names = ${pick("speaker_names")}, duration = ${pick("duration")}, language = ${pick("language")}, key_source = NULL, error = NULL, auto_pending = '' WHERE id = ? AND status = 'done'`,
        params: [meetingId],
      },
      { sql: "DELETE FROM transcript_versions WHERE id = ? AND meeting_id = ?", params: [versionId, meetingId] },
      prune!,
    ]);
    return true;
  }
  async deleteTranscriptVersion(meetingId: string, versionId: number) {
    const { changes } = await this.db.run("DELETE FROM transcript_versions WHERE id = ? AND meeting_id = ?", [versionId, meetingId]);
    return changes > 0;
  }

  /* ---------- minutes ---------- */

  /** Every version of a meeting's minutes, newest first (one per generation, to compare models). */
  async minutesList(meetingId: string) {
    return this.db.all<MinutesRow>(`SELECT ${MINUTES_COLUMNS} FROM minutes WHERE meeting_id = ? ORDER BY created_at DESC, id DESC`, [meetingId]);
  }
  /** The newest version, or one by id. */
  async minutes(meetingId: string, id?: number) {
    return id === undefined
      ? this.db.first<MinutesRow>(`SELECT ${MINUTES_COLUMNS} FROM minutes WHERE meeting_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, [meetingId])
      : this.db.first<MinutesRow>(`SELECT ${MINUTES_COLUMNS} FROM minutes WHERE meeting_id = ? AND id = ?`, [meetingId, id]);
  }
  /** A new version; only the newest MAX_MINUTES_VERSIONS are kept. */
  async addMinutes(meetingId: string, m: { body: string; provider: string; model: string }, now: number) {
    await this.db.run("INSERT INTO minutes (meeting_id, body, provider, model, edited, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)", [meetingId, m.body, m.provider, m.model, now, now]);
    await this.db.run(
      "DELETE FROM minutes WHERE meeting_id = ? AND id NOT IN (SELECT id FROM minutes WHERE meeting_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)",
      [meetingId, meetingId, MAX_MINUTES_VERSIONS],
    );
  }
  /**
   * Changes a version's text, by hand or on request to a model (revisedWith); the previous text can
   * be brought back with undoMinutes. With `expected`, refuses if the text changed meanwhile.
   */
  async editMinutes(meetingId: string, id: number, body: string, now: number, opts: { revisedWith?: string; expected?: string } = {}): Promise<EditOutcome> {
    const row = await this.db.first<{ body: string; edited: number; revised_with: string | null; undo: string }>(
      "SELECT body, edited, revised_with, undo FROM minutes WHERE meeting_id = ? AND id = ?",
      [meetingId, id],
    );
    if (!row) return "not_found";
    if (opts.expected !== undefined && row.body !== opts.expected) return "changed";
    if (row.body === body) return "ok";
    const undo = [...undoList(row.undo), { body: row.body, edited: row.edited, revised_with: row.revised_with }];
    while (undo.length > MAX_UNDO || (undo.length > 1 && JSON.stringify(undo).length > MAX_UNDO_CHARS)) undo.shift();
    const { changes } = await this.db.run(
      "UPDATE minutes SET body = ?, edited = 1, revised_with = ?, undo = ?, updated_at = ? WHERE meeting_id = ? AND id = ? AND body = ?",
      [body, opts.revisedWith ?? row.revised_with, JSON.stringify(undo), now, meetingId, id, row.body],
    );
    return changes > 0 ? "ok" : "changed";
  }
  /** Brings back the text before the last change. */
  async undoMinutes(meetingId: string, id: number, now: number): Promise<EditOutcome> {
    const row = await this.db.first<{ body: string; undo: string }>("SELECT body, undo FROM minutes WHERE meeting_id = ? AND id = ?", [meetingId, id]);
    if (!row) return "not_found";
    const undo = undoList(row.undo);
    const last = undo.pop();
    if (!last) return "not_found";
    const { changes } = await this.db.run(
      "UPDATE minutes SET body = ?, edited = ?, revised_with = ?, undo = ?, updated_at = ? WHERE meeting_id = ? AND id = ? AND body = ?",
      [last.body, last.edited, last.revised_with, JSON.stringify(undo), now, meetingId, id, row.body],
    );
    return changes > 0 ? "ok" : "changed";
  }
  /** One version, or all of them. */
  async deleteMinutes(meetingId: string, id?: number) {
    if (id === undefined) await this.db.run("DELETE FROM minutes WHERE meeting_id = ?", [meetingId]);
    else await this.db.run("DELETE FROM minutes WHERE meeting_id = ? AND id = ?", [meetingId, id]);
  }
  async addLlmUsage(u: { userId: string; meetingId: string | null; provider: string; model: string; purpose: string; inputTokens: number; outputTokens: number; now: number }) {
    await this.db.run(
      "INSERT INTO llm_usage (user_id, meeting_id, provider, model, purpose, input_tokens, output_tokens, month, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [u.userId, u.meetingId, u.provider, u.model, u.purpose, u.inputTokens, u.outputTokens, monthOf(u.now), u.now],
    );
  }
  async llmUsageOf(userId: string, month?: string) {
    return month
      ? this.db.all<{ provider: string; requests: number; input_tokens: number; output_tokens: number }>(
          "SELECT provider, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM llm_usage WHERE user_id = ? AND month = ? GROUP BY provider",
          [userId, month],
        )
      : this.db.all<{ month: string; provider: string; requests: number; input_tokens: number; output_tokens: number }>(
          "SELECT month, provider, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM llm_usage WHERE user_id = ? GROUP BY month, provider ORDER BY month DESC",
          [userId],
        );
  }

  /* ---------- provider keys ---------- */

  async providerKeys(userId: string) {
    return this.db.all<{ provider: string; last4: string; created_at: number }>("SELECT provider, last4, created_at FROM provider_keys WHERE user_id = ? ORDER BY provider", [userId]);
  }
  async sealedKey(userId: string, provider: string) {
    return this.db.first<{ ciphertext: string; iv: string }>("SELECT ciphertext, iv FROM provider_keys WHERE user_id = ? AND provider = ?", [userId, provider]);
  }
  async saveProviderKey(userId: string, provider: string, k: { ciphertext: string; iv: string; last4: string; version: number }, now: number) {
    await this.db.run(
      `INSERT INTO provider_keys (user_id, provider, ciphertext, iv, last4, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, last4 = excluded.last4, version = excluded.version, created_at = excluded.created_at`,
      [userId, provider, k.ciphertext, k.iv, k.last4, k.version, now],
    );
  }
  async deleteProviderKey(userId: string, provider: string) {
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
    await this.db.batch([
      { sql: "DELETE FROM usage WHERE month < ?", params: [beforeMonth] },
      { sql: "DELETE FROM llm_usage WHERE month < ?", params: [beforeMonth] },
    ]);
  }
}
