CREATE TABLE IF NOT EXISTS user_address (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  receiver_name TEXT NOT NULL,
  mobile TEXT,
  province TEXT,
  city TEXT,
  district TEXT,
  detail TEXT NOT NULL,
  in_service_range INTEGER NOT NULL DEFAULT 1 CHECK (in_service_range IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS signin_session (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  signin_date TEXT NOT NULL,
  ad_groups INTEGER NOT NULL,
  completed_groups INTEGER NOT NULL DEFAULT 0,
  completed_ads INTEGER NOT NULL DEFAULT 0,
  signed_today INTEGER NOT NULL DEFAULT 0 CHECK (signed_today IN (0, 1)),
  lottery_ticket INTEGER NOT NULL DEFAULT 0,
  lottery_used INTEGER NOT NULL DEFAULT 0 CHECK (lottery_used IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, signin_date)
);

CREATE TABLE IF NOT EXISTS withdraw_request (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  arrival_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (arrival_amount_cents >= 0),
  channel TEXT NOT NULL DEFAULT 'wechat',
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected', 'paying', 'success', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_status_log (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  operator_type TEXT NOT NULL,
  operator_id TEXT,
  from_status TEXT,
  to_status TEXT,
  from_fulfillment_status TEXT,
  to_fulfillment_status TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_operation_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  role_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_address_user ON user_address(user_id);
CREATE INDEX IF NOT EXISTS idx_signin_session_user_date ON signin_session(user_id, signin_date);
CREATE INDEX IF NOT EXISTS idx_withdraw_request_user_status ON withdraw_request(user_id, status);
CREATE INDEX IF NOT EXISTS idx_order_status_log_order ON order_status_log(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_operation_log_role ON admin_operation_log(role_id, created_at);
