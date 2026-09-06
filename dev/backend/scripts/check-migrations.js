const fs = require("fs");
const path = require("path");

const migrationDir = path.resolve(__dirname, "..", "database", "migrations");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  assert(fs.existsSync(filePath), `Missing migration file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

const migrationFiles = fs
  .readdirSync(migrationDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => path.join(migrationDir, file));
const migrations = migrationFiles.map(read).join("\n");

const requiredTables = [
  "app_config",
  "app_user",
  "user_address",
  "product",
  "pickup_site",
  "delivery_team",
  "delivery_staff",
  "invite_relation",
  "task",
  "task_submission",
  "shop_order",
  "order_item",
  "payment_order",
  "point_ledger",
  "withdrawable_ledger",
  "withdraw_request",
  "refund_order",
  "admin_role",
  "admin_role_permission",
  "order_status_log",
  "admin_operation_log",
  "admin_approval_request",
  "operation_ticket",
  "inventory_ledger",
  "signin_session",
  "exception_compensation"
];

for (const table of requiredTables) {
  assert(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`, "i").test(migrations), `Missing table: ${table}`);
}

const requiredColumns = [
  "payment_mode",
  "cash_amount_cents",
  "point_amount",
  "fulfillment_status",
  "idempotency_key",
  "pure_points_only",
  "withdrawable_balance_cents",
  "signin_date",
  "operator_type",
  "reviewed_by_role_id"
  ,
  "ticket_type",
  "admin_reply"
  ,
  "quantity_delta",
  "stock_before",
  "stock_after",
  "batch_no",
  "linked_type",
  "linked_id",
  "priority"
];

for (const column of requiredColumns) {
  assert(new RegExp(`\\b${column}\\b`, "i").test(migrations), `Missing important column: ${column}`);
}

const requiredIndexes = [
  "idx_product_category_status",
  "idx_order_user_status",
  "idx_point_ledger_user_created",
  "idx_exception_status",
  "idx_invite_relation_inviter",
  "idx_user_address_user",
  "idx_signin_session_user_date",
  "idx_withdraw_request_user_status",
  "idx_order_status_log_order",
  "idx_admin_approval_request_status"
  ,
  "idx_operation_ticket_type_status",
  "idx_operation_ticket_user_created",
  "idx_inventory_ledger_product_created",
  "idx_inventory_ledger_type_created",
  "idx_operation_ticket_linked",
  "idx_operation_ticket_priority_status"
];

for (const index of requiredIndexes) {
  assert(new RegExp(`CREATE INDEX IF NOT EXISTS\\s+${index}\\b`, "i").test(migrations), `Missing index: ${index}`);
}

const requiredSeedValues = [
  "u_1001",
  "u_1002",
  "p_banana",
  "p_bokchoy",
  "site_001",
  "team_001",
  "u_1002', 'u_1001",
  "super_admin",
  "customer_service",
  "ledger:read",
  "order:read"
];

for (const value of requiredSeedValues) {
  assert(migrations.includes(value), `Missing seed value: ${value}`);
}

console.log("Migration checks passed");
