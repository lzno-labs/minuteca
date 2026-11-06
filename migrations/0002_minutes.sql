-- Minutes and speaker names with language models (docs/adr/0004-language-models.md).

-- The language model each person chose, a model per provider ({"anthropic": "claude-..."}) and
-- their own instructions for the minutes (format, sections, tone).
ALTER TABLE users ADD COLUMN llm_provider TEXT;
ALTER TABLE users ADD COLUMN llm_models TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN minutes_instructions TEXT NOT NULL DEFAULT '';

-- One minutes document per meeting, in Markdown. edited = 1 once the person changed it by hand.
CREATE TABLE minutes (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Tokens per language model call: the person's own keys pay, this ledger only shows it.
CREATE TABLE llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  meeting_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  month TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX llm_usage_user ON llm_usage(user_id, month);
