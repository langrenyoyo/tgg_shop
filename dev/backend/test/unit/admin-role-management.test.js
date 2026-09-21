process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { normalizeState } = require("../../src/data/state-normalizer");
const admin = require("../../src/services/admin-service");
const auth = require("../../src/services/auth-service");
const { requireAdminPermission } = require("../../src/domain/auth");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");

const actor = state => ({ role: state.roles.find(role => role.id === "super_admin") });

test("role edits revoke permissions in existing sessions, survive normalization, and record an audit", () => {
  const state = createSeed();
  const login = auth.adminLogin(state, { roleId: "product_admin", password: "123456" });
  const req = { headers: { authorization: `Bearer ${login.token}` } };
  assert.equal(requireAdminPermission(req, state, "stock:write").ok, true);
  const result = admin.updateRole(state, "product_admin", {
    name: "商品只读", permissions: ["product:read"], reason: "撤销库存修改权限"
  }, actor(state));
  assert.equal(result.ok, true);
  assert.equal(requireAdminPermission(req, state, "stock:write").status, 403);
  assert.equal(requireAdminPermission(req, state, "product:read").ok, true);
  const loaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(loaded.roles.find(role => role.id === "product_admin").permissions, ["product:read"]);
  assert.equal(loaded.roles.find(role => role.id === "product_admin").name, "商品只读");
  assert.equal(state.adminOperationLogs[0].action, "role.update");
  assert.ok(state.adminOperationLogs[0].before.permissions.includes("stock:write"));
  assert.deepEqual(state.adminOperationLogs[0].after.permissions, ["product:read"]);
  const { loadSQLiteState, saveSQLiteState } = require("../../src/data/sqlite-store");
  saveSQLiteState(state, ":memory:");
  const sqliteLoaded = normalizeState(loadSQLiteState(":memory:"));
  assert.deepEqual(sqliteLoaded.roles.find(role => role.id === "product_admin").permissions, ["product:read"]);
});

test("permission catalog stays complete even after every assignable role is cleared", () => {
  const state = createSeed();
  for (const role of state.roles.filter(role => role.id !== "super_admin")) {
    assert.equal(admin.updateRole(state, role.id, { name: role.name, permissions: [], reason: "测试撤销" }, actor(state)).ok, true);
  }
  assert.ok(admin.listPermissionCatalog().includes("stock:write"));
  assert.ok(!admin.listPermissionCatalog().includes("*"));
  assert.deepEqual(normalizeState(state).roles.find(role => role.id === "product_admin").permissions, []);
});

test("role edits reject escalation, invalid permissions and protected roles without changing state", () => {
  const state = createSeed();
  const input = { name: "测试角色", permissions: ["product:read"], reason: "测试" };
  const before = JSON.stringify(state);
  assert.equal(admin.updateRole(state, "super_admin", input, actor(state)).status, 400);
  assert.equal(admin.updateRole(state, "product_admin", { ...input, permissions: ["*"] }, actor(state)).status, 400);
  assert.equal(admin.updateRole(state, "product_admin", { ...input, permissions: ["invalid:write"] }, actor(state)).status, 400);
  assert.equal(admin.updateRole(state, "product_admin", { ...input, reason: "" }, actor(state)).status, 400);
  assert.equal(admin.updateRole(state, "product_admin", input, { role: state.roles.find(role => role.id === "customer_service") }).status, 403);
  assert.equal(admin.updateRole(state, "product_admin", input, { role: { id: "delegated", permissions: ["role:write", "product:read"] } }).status, 403);
  assert.equal(JSON.stringify(state), before);
});

test("role write route enforces authentication and permission before mutation", async () => {
  const state = createSeed();
  const login = auth.adminLogin(state, { roleId: "customer_service", password: "123456" });
  let response;
  await handleAdminRoutes({
    req: { method: "PATCH", headers: { authorization: `Bearer ${login.token}` } },
    url: new URL("http://localhost/api/admin/permissions/product_admin"), state,
    readBody: async () => { throw new Error("Must not read unauthorized request body"); },
    send: (res, status, body) => { response = { status, body }; }
  });
  assert.equal(response.status, 403);
});

test("dashboard summary counts all users and queues independently of restricted list requests", () => {
  const state = createSeed();
  state.refundOrders.push({ id: "pending", status: "pending_review", createdAt: new Date().toISOString() }, { id: "done", status: "approved", createdAt: new Date().toISOString() });
  state.submissions = [{ id: "submission", createdAt: new Date().toISOString() }];
  state.orders = [{ id: "refunding-order", status: "refunding", cashAmount: 12.5, createdAt: new Date().toISOString() }];
  const summary = admin.getSummary(state, { range: "month" });
  assert.equal(summary.userCount, state.users.length);
  assert.equal(summary.pendingRefundCount, state.refundOrders.filter(item => item.status === "pending_review").length);
  assert.equal(summary.analytics.dashboard.selected.refundCount, 2);
  assert.equal(summary.analytics.dashboard.selected.taskCount, 1);
  assert.equal(summary.analytics.dashboard.selected.gmv, 12.5);
  assert.equal(summary.paymentLedgerCount, state.paymentLedger.length);
  assert.equal(summary.pendingExceptionCount, state.exceptions.filter(item => item.status === "pending").length);
});

test("home configuration exposes the selected active banner product outside recommendations", () => {
  const state = createSeed();
  const { getHome } = require("../../src/services/catalog-service");
  admin.updateConfig(state, {
    homeBannerTitle: "积分专场", homeBannerProductId: "p_banana", homePromotionEntries: [], reason: "首页运营调整"
  }, actor(state));
  const home = getHome(state, state.users[0]);
  assert.equal(home.banners[0].title, "积分专场");
  assert.equal(home.bannerProduct.id, "p_banana");
  assert.equal(home.bannerProduct.purePointsOnly, true);
  assert.deepEqual(home.promotionEntries, []);
  state.products.find(product => product.id === "p_banana").status = "off";
  assert.equal(getHome(state, state.users[0]).bannerProduct, null);
});
