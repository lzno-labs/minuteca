-- Automatic names and minutes, and revising minutes (docs/design/automatic-minutes-and-revisions.md).

-- Steps each person wants once a transcription finishes: "names", "minutes" (comma separated).
ALTER TABLE users ADD COLUMN auto_steps TEXT NOT NULL DEFAULT '';
-- Steps still to run for a meeting's current transcript; the app runs them and takes each once.
ALTER TABLE meetings ADD COLUMN auto_pending TEXT NOT NULL DEFAULT '';
-- Earlier texts of a minutes version (JSON array, newest last, the last 5) and the provider that
-- last revised it on request.
ALTER TABLE minutes ADD COLUMN undo TEXT NOT NULL DEFAULT '[]';
ALTER TABLE minutes ADD COLUMN revised_with TEXT;
