-- Earlier transcripts of a meeting, kept when it is transcribed again (another provider, or on the
-- computer), so people can compare them and go back. Each keeps the voice names it had.
CREATE TABLE transcript_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  speaker_names TEXT NOT NULL DEFAULT '{}',
  duration REAL NOT NULL DEFAULT 0,
  language TEXT,
  archived_at INTEGER NOT NULL
);
CREATE INDEX transcript_versions_meeting ON transcript_versions(meeting_id, archived_at);
