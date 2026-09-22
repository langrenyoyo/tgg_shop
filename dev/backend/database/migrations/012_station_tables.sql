CREATE TABLE IF NOT EXISTS station_account (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  site_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS station_order (
  order_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  station_status TEXT NOT NULL,
  shelf_code TEXT,
  record_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS station_operation_log (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  order_id TEXT,
  operator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT,
  idempotency_key TEXT UNIQUE,
  record_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_station_order_site_status ON station_order(site_id, station_status);
CREATE INDEX IF NOT EXISTS idx_station_log_site_created ON station_operation_log(site_id, created_at);
