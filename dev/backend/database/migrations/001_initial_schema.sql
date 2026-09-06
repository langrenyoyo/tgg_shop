-- TGG Shop initial database schema.
-- Dialect target: SQLite-compatible SQL for development migrations.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  phone TEXT,
  user_type TEXT NOT NULL DEFAULT 'normal' CHECK (user_type IN ('normal', 'member')),
  member_until TEXT,
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  withdrawable_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (withdrawable_balance_cents >= 0),
  invite_code TEXT UNIQUE NOT NULL,
  signin_streak INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  cash_price_cents INTEGER,
  points_price INTEGER,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  tag TEXT,
  image_url TEXT,
  supports_cash INTEGER NOT NULL DEFAULT 1 CHECK (supports_cash IN (0, 1)),
  supports_points INTEGER NOT NULL DEFAULT 1 CHECK (supports_points IN (0, 1)),
  pure_points_only INTEGER NOT NULL DEFAULT 0 CHECK (pure_points_only IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on', 'off')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pickup_site (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  verify_mode TEXT NOT NULL DEFAULT 'pickup_code',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_team (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service_area TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_staff (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES delivery_team(id),
  name TEXT NOT NULL,
  phone TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  reward_points INTEGER NOT NULL DEFAULT 0,
  list_reward_hidden INTEGER NOT NULL DEFAULT 1 CHECK (list_reward_hidden IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'off')),
  submit_fields_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_submission (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  status TEXT NOT NULL DEFAULT 'reviewing' CHECK (status IN ('reviewing', 'approved', 'rejected')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shop_order (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cash', 'pure_points', 'points_plus_cash')),
  cash_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_amount_cents >= 0),
  point_amount INTEGER NOT NULL DEFAULT 0 CHECK (point_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid', 'refunding', 'refunded', 'cancelled', 'completed', 'closed')),
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('pickup', 'delivery')),
  pickup_site_id TEXT REFERENCES pickup_site(id),
  pickup_code TEXT,
  delivery_address TEXT,
  delivery_date TEXT,
  fulfillment_status TEXT NOT NULL CHECK (fulfillment_status IN ('not_started', 'pending_pickup', 'pending_ship', 'shipping', 'delivered', 'picked_up')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_item (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES shop_order(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES product(id),
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cash_price_cents INTEGER,
  points_price INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_order (
  id TEXT PRIMARY KEY,
  pay_no TEXT UNIQUE,
  order_id TEXT REFERENCES shop_order(id),
  user_id TEXT REFERENCES app_user(id),
  pay_scene TEXT NOT NULL DEFAULT 'goods_cash',
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  point_amount INTEGER NOT NULL DEFAULT 0 CHECK (point_amount >= 0),
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  third_trade_no TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  callback_time TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  change_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  points INTEGER NOT NULL CHECK (points >= 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  biz_no TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawable_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  change_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'freeze', 'unfreeze')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
  biz_no TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refund_order (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES shop_order(id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  refund_cash_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (refund_cash_amount_cents >= 0),
  refund_point_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_point_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected', 'refunding', 'refunded', 'failed')),
  reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_role (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_role_permission (
  role_id TEXT NOT NULL REFERENCES admin_role(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS exception_compensation (
  id TEXT PRIMARY KEY,
  exception_type TEXT NOT NULL,
  biz_no TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'resolved', 'failed', 'ignored')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_category_status ON product(category, status);
CREATE INDEX IF NOT EXISTS idx_order_user_status ON shop_order(user_id, status);
CREATE INDEX IF NOT EXISTS idx_order_fulfillment ON shop_order(fulfillment_type, fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_point_ledger_user_created ON point_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_submission_user_status ON task_submission(user_id, status);
CREATE INDEX IF NOT EXISTS idx_exception_status ON exception_compensation(status, exception_type);
