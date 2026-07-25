-- Inventory traceability for mall-style stock operations.

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('initial_stock', 'purchase_in', 'stocktake', 'loss', 'adjust', 'order_deduct', 'order_restore', 'refund_restore')),
  quantity_delta INTEGER NOT NULL,
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  batch_no TEXT,
  reason TEXT,
  operator_role_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product_created ON inventory_ledger(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_type_created ON inventory_ledger(change_type, created_at);
