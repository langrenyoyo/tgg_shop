CREATE TABLE IF NOT EXISTS invite_relation (
  invitee_user_id TEXT PRIMARY KEY REFERENCES app_user(id),
  inviter_user_id TEXT NOT NULL REFERENCES app_user(id),
  bound_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invite_relation_inviter ON invite_relation(inviter_user_id);

INSERT OR IGNORE INTO invite_relation (invitee_user_id, inviter_user_id, bound_at) VALUES
  ('u_1002', 'u_1001', CURRENT_TIMESTAMP);
