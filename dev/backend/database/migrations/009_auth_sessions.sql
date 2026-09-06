CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'admin')),
  subject_id TEXT NOT NULL,
  token_id TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_login_attempt (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_failed_at TEXT,
  PRIMARY KEY (subject_type, subject_id)
);
