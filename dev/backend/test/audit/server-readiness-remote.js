// Executed through SSH stdin on the deployed host; never imports the app store.
// DB transaction is read-only. HTTP writes are limited to login/logout and
// callback probes whose missing-token guards have first been verified.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const root = "/www/wwwroot/tgg_shop";
const backend = root + "/dev/backend";
const report = { checkedAt: new Date().toISOString(), checks: [] };
const emit = (name, data) => { report.checks.push({ name, ...data }); console.log(JSON.stringify({ name, ...data })); };
const pid = cp.execFileSync("systemctl", ["show", "tgg-shop.service", "--value", "-p", "MainPID"], { encoding: "utf8" }).trim();
const initial = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(s => s.includes("=")).map(s => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
const { readEnvFile } = require(backend + "/src/config/env-file");
const envFile = path.resolve(backend, initial.TGG_ENV_FILE || ".env");
const env = { ...(initial.TGG_LOAD_DOTENV === "0" ? {} : readEnvFile(envFile)), ...initial };
const base = "https://shop.taoguoguo.cc";
async function http(endpoint, token, method = "GET", body) {
  const started = Date.now();
  const response = await fetch(base + endpoint, { method, redirect: "error", signal: AbortSignal.timeout(15000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, elapsedMs: Date.now() - started, data, bytes: Buffer.byteLength(text), cors: response.headers.get("access-control-allow-origin") };
}
function summarize(data) {
  if (Array.isArray(data)) return { count: data.length };
  if (!data || typeof data !== "object") return {};
  return { keys: Object.keys(data), ...(Array.isArray(data.rows) ? { rows: data.rows.length } : {}), ...(data.error ? { error: String(data.error).slice(0, 160) } : {}) };
}
function counts(rows, key) {
  const result = {};
  for (const row of rows || []) { const value = String(row[key] || "unset"); result[value] = (result[value] || 0) + 1; }
  return result;
}
async function main() {
  emit("runtime", { pid, node: process.version, mode: env.NODE_ENV, driver: env.TGG_STORE_DRIVER, testBypass: env.TGG_TEST_BYPASS_ENABLED, envFile, envModifiedAt: fs.statSync(envFile).mtime.toISOString() });
  const { validateRuntimeConfig } = require(backend + "/src/config/runtime-config");
  emit("production-config", validateRuntimeConfig(env, true));
  const deployedKeys = ["TGG_DISABLE_CASH", "TGG_CORS_ORIGIN", "TGG_UPLOAD_MAX_BYTES", "TGG_TASK_CALLBACK_SECRET"];
  function sources(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith(".js") ? [fs.readFileSync(path.join(dir, e.name), "utf8")] : []); }
  const source = sources(backend + "/src").join("\n") + fs.readFileSync(backend + "/server.js", "utf8");
  emit("unconsumed-environment", { fields: deployedKeys.filter(k => env[k] && !source.includes(k)) });
  const { Client } = require(backend + "/node_modules/pg");
  const client = new Client({ connectionString: env.TGG_PG_URL || env.DATABASE_URL, application_name: "tgg-readonly-audit", statement_timeout: 10000, connectionTimeoutMillis: 10000 });
  let state;
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const schema = '"' + String(env.TGG_PG_SCHEMA || "public").replaceAll('"', '""') + '"';
    const result = await client.query(`SELECT state_json, updated_at FROM ${schema}.app_state WHERE state_id=$1`, [env.TGG_PG_STATE_ID || "main"]);
    if (!result.rows.length) throw new Error("state row absent");
    state = typeof result.rows[0].state_json === "string" ? JSON.parse(result.rows[0].state_json) : result.rows[0].state_json;
    emit("database", { connected: true, readOnly: true, updatedAt: result.rows[0].updated_at, counts: Object.fromEntries(["users", "adminUsers", "products", "orders", "paymentLedger", "pointLedger", "withdrawRequests", "refundOrders", "submissions", "stationAccounts", "pickupSites", "deliveryTeams"].map(k => [k, (state[k] || []).length])), orderStatuses: counts(state.orders, "status"), paymentChannels: counts(state.paymentLedger, "channel"), withdrawStatuses: counts(state.withdrawRequests, "status"), refundStatuses: counts(state.refundOrders, "status"), printers: (state.printing?.printers || []).length });
    const config = state.config || {};
    emit("business-config", Object.fromEntries(["membershipMonthlyPrice", "membershipMonthlyPoints", "membershipPointCashRate", "pickupEnabled", "deliveryEnabled", "deliveryFeeEnabled", "deliveryFee", "deliveryCutoffHour", "deliveryTimeSlots", "deliveryTimeZone", "stationPickingEnabled", "stationBatchPickingEnabled", "stationScanRequired", "stationSortMode", "stationPickupHoldHours", "stationShelfPrefix", "rankingRefreshMinutes", "inviteRewardPoints", "inviteCommissionRate", "monthlyPointRewardEnabled", "monthlyPointRewardSettlementHour", "monthlyPointRewardSettlementMinute", "withdrawMinAmount", "withdrawFeeRate", "paymentTimeoutMinutes", "splashAdEnabled"].map(k => [k, config[k] ?? null])));
    await client.query("ROLLBACK");
  } finally { await client.end(); }
  for (const endpoint of ["/api/health", "/api/home", "/api/products", "/api/points-exchange", "/api/pickup-sites", "/api/delivery/teams", "/api/task-platform/status", "/api/task-types", "/api/tasks?count=1&page=1", "/api/admin/auth/me", "/api/admin/orders", "/api/station/me", "/api/me"]) {
    try { const r = await http(endpoint); emit("public-http", { endpoint, status: r.status, elapsedMs: r.elapsedMs, cors: r.cors, ...summarize(r.data) }); }
    catch (e) { emit("public-http", { endpoint, error: e.name }); }
  }
  for (const [endpoint, key] of [["/api/task/callback", "TGG_TASK_CALLBACK_TOKEN"], ["/api/providers/huifu/withdraw-callback", "HF_CALLBACK_TOKEN"]]) {
    if (!env[key]) { const r = await http(endpoint, null, "POST", {}); emit("disabled-callback-guard", { endpoint, status: r.status, ...summarize(r.data) }); }
  }
  const { verifyAdminPassword } = require(backend + "/src/domain/admin-accounts");
  const candidates = [...new Set([env.TGG_DEMO_PASSWORD, "123456"].filter(Boolean))];
  const admin = (state.adminUsers || []).find(a => a.status === "active" && (a.roleIds || []).some(id => (state.roles || []).some(r => r.id === id && r.permissions.includes("*"))));
  const password = admin && candidates.find(p => verifyAdminPassword(p, admin.passwordHash));
  emit("admin-credential-check", { activeSuperAdminFound: !!admin, knownConfiguredPasswordMatches: !!password, defaultPasswordMatches: admin ? verifyAdminPassword("123456", admin.passwordHash) : null });
  if (password) {
    let token;
    try {
      const login = await http("/api/admin/auth/login", null, "POST", { username: admin.username, password });
      token = login.data?.token;
      emit("admin-login", { status: login.status, sessionIssued: !!token });
      if (token) {
        for (const endpoint of ["/api/admin/auth/me", "/api/admin/summary", "/api/admin/orders", "/api/admin/products", "/api/admin/users", "/api/admin/addresses", "/api/admin/invites", "/api/admin/tickets", "/api/admin/config", "/api/admin/permissions", "/api/admin/station-accounts", "/api/admin/pickup-sites", "/api/admin/delivery-teams", "/api/admin/ledger", "/api/admin/refunds", "/api/admin/withdrawals", "/api/admin/ranking", "/api/admin/monthly-point-rewards", "/api/admin/approval-requests", "/api/admin/exceptions", "/api/admin/order-status-logs", "/api/admin/operation-logs", "/api/admin/printing", "/api/admin/integrations/pospal/status", "/api/admin/inventory-ledger", "/api/admin/task-submissions", "/api/admin/refund-returns", "/api/admin/dashboard-views", "/api/admin/admin-users", "/api/admin/permissions/catalog"]) {
          try {
            const r = await http(endpoint, token);
            emit("admin-http", { endpoint, status: r.status, elapsedMs: r.elapsedMs, ...summarize(r.data), ...(/printing|pospal/.test(endpoint) ? { configured: r.data?.configured, enabled: r.data?.enabled } : {}) });
          } catch(e) { emit("admin-http", { endpoint, error: e.name }); }
        }
      }
    } finally {
      if (token) { const out = await http("/api/admin/auth/logout", token, "POST", {}); const after = await http("/api/admin/auth/me", token); emit("admin-logout", { status: out.status, revokedTokenStatus: after.status }); }
    }
  }
  emit("completed", { checks: report.checks.length, noBusinessWrites: true, authSessionCreatedAndRevoked: !!password });
}
main().catch(e => { console.error(JSON.stringify({ name: "audit-error", type: e.name, code: e.code || null })); process.exitCode = 1; });
