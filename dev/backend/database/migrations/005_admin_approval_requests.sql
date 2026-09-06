CREATE TABLE IF NOT EXISTS admin_approval_request (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
  request_reason TEXT,
  review_reason TEXT,
  requested_by_role_id TEXT,
  reviewed_by_role_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_approval_request_status ON admin_approval_request(status, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_approval_request_target ON admin_approval_request(target_type, target_id);
