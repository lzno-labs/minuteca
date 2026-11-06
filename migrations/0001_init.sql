-- minuteca schema. Applied by `npm start` on SQLite and by `wrangler d1 migrations apply` on D1.
-- Migrations only add tables or columns; an applied file is never edited.

-- The access list: only 'admin' and 'member' can sign in. 'removed' keeps the row (and the
-- person's meetings until they expire) but blocks sign-in.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'removed')),
  added_by TEXT,
  created_at INTEGER NOT NULL,
  -- Provider used for new transcriptions.
  provider TEXT NOT NULL DEFAULT 'deepgram',
  -- JSON array of providers this person agreed to send audio to (AGENTS: explicit permission).
  consents TEXT NOT NULL DEFAULT '[]'
);

-- One-time sign-in links. Only the SHA-256 of the token is stored.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- 'web' or 'app'. App links carry the PKCE challenge of the device that asked.
  client TEXT NOT NULL,
  challenge TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('web', 'app')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- status: created (no audio yet), uploaded, transcribing, done, error.
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'created',
  error TEXT,
  duration REAL NOT NULL DEFAULT 0,
  language TEXT,
  speaker_names TEXT NOT NULL DEFAULT '{}',
  audio_key TEXT,
  audio_type TEXT,
  audio_bytes INTEGER,
  provider TEXT,
  key_source TEXT,
  job_id TEXT,
  job_token_hash TEXT,
  job_started_at INTEGER,
  usage_id INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX meetings_user ON meetings(user_id, date);
CREATE INDEX meetings_expiry ON meetings(expires_at);
CREATE INDEX meetings_status ON meetings(status);

CREATE TABLE transcripts (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  body TEXT NOT NULL
);

-- Each person's own provider keys, encrypted (docs/design/own-provider-keys.md).
CREATE TABLE provider_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  last4 TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);

-- Transcription minutes per person and month: the one ledger every AI call goes through.
-- key_source is 'own' (the person's key) or 'hosted' (the keys of whoever runs the server).
CREATE TABLE usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  meeting_id TEXT,
  provider TEXT NOT NULL,
  key_source TEXT NOT NULL,
  month TEXT NOT NULL,
  seconds REAL NOT NULL,
  final INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX usage_month ON usage(month, key_source);
CREATE INDEX usage_user ON usage(user_id, month);
