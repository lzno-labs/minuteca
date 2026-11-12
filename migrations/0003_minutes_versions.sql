-- Several minutes per meeting, one per generation, so people can compare language models
-- (docs/design/minutes-with-llm.md). Existing minutes become the first version of their meeting.
CREATE TABLE minutes_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO minutes_versions (meeting_id, body, provider, model, edited, created_at, updated_at)
  SELECT meeting_id, body, provider, model, edited, created_at, updated_at FROM minutes;
DROP TABLE minutes;
ALTER TABLE minutes_versions RENAME TO minutes;
CREATE INDEX minutes_meeting ON minutes(meeting_id, created_at);
