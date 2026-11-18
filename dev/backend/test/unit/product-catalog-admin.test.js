process.env.TGG_STORE_MODE = "memory";
const test = require("node:test"), assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const service = require("../../src/services/product-catalog-admin");
const admin = require("../../src/services/admin-service");
const repo = require("../../src/repositories/product-repository");
const catalog = require("../../src/services/catalog-service");
const { searchAdmin } = require("../../src/services/admin-search-service");
const { createOrder } = require("../../src/domain/rules");
const { loadSQLiteState, saveSQLiteState } = require("../../src/data/sqlite-store");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");
const { issueToken } = require("../../src/domain/auth");
const actor = { role: { id: "product_admin", permissions: ["product:write", "points_product:write", "stock:write"] } };
const move = (state, id, position, extra = {}) => service.moveProduct(state, id, { position, expectedRevision: state.products.find(item => item.id === id)?.revision || 0, expectedOrder: repo.listVisible(state).map(item => item.id), ...extra }, actor, admin.logOperation);

test("products move from last to first, middle and last across admin, home and paginated catalogs", () => {
  const state = createSeed(), original = repo.listVisible(state).map(item => item.id);
  const id = original.at(-1);
  assert.equal(move(state, id, 1).ok, true);
  assert.equal(repo.listVisible(state)[0].id, id);
  assert.equal(catalog.listProducts(state)[0].id, id);
  assert.equal(catalog.listProductPage(state).items[0].id, id);
  assert.equal(move(state, id, 3).ok, true);
  assert.equal(repo.listVisible(state)[2].id, id);
  assert.equal(move(state, id, original.length).ok, true);
  assert.deepEqual(repo.listVisible(state).map(item => item.id), original);
  const cash = repo.listActive(state).filter(item => !item.purePointsOnly).at(-1);
  move(state, cash.id, 1);
  assert.equal(catalog.getHome(state, state.users[0]).recommendProducts[0].id, cash.id);
  assert.equal(state.adminOperationLogs[0].action, "product.reorder");
});

test("stale order, invalid position and missing write permissions cannot change catalog", () => {
  const state = createSeed(), id = state.products[0].id, before = JSON.stringify(state);
  for (const position of [0, -1, 1.5, 999, "1"]) assert.equal(move(state, id, position).status, 400);
  assert.equal(move(state, id, 1, { expectedOrder: [] }).status, 409);
  assert.equal(move(state, id, 1, { expectedRevision: 999 }).status, 409);
  assert.equal(service.moveProduct(state, id, {}, { role: { permissions: [] } }, admin.logOperation).status, 403);
  assert.equal(JSON.stringify(state), before);
});

test("product deletion hides goods, blocks republishing and purchase, retains historic order and stock references", () => {
  const state = createSeed(), product = state.products[0];
  const order = createOrder(state, "u_1001", { paymentMode: "pure_points", fulfillmentType: "pickup", items: [{ productId: product.id, quantity: 1 }] });
  assert.equal(order.ok, true);
  const history = JSON.stringify(state.orders), stock = product.stock;
  const deleted = service.deleteProduct(state, product.id, { expectedRevision: product.revision || 0 }, actor, admin.logOperation);
  assert.equal(deleted.ok, true);
  assert.equal(product.status, "off");
  assert.ok(product.deletedAt);
  assert.equal(product.stock, stock);
  assert.equal(JSON.stringify(state.orders), history);
  assert.equal(repo.findById(state, product.id), product);
  assert.equal(repo.findActiveById(state, product.id), null);
  assert.equal(repo.listVisible(state).some(item => item.id === product.id), false);
  assert.equal(searchAdmin(state, product.id, ["product:read"]).total, 0);
  assert.equal(admin.updateProduct(state, product.id, { status: "on", reason: "重新上架" }, actor).status, 404);
  assert.equal(createOrder(state, "u_1001", { paymentMode: "pure_points", fulfillmentType: "pickup", items: [{ productId: product.id, quantity: 1 }] }).ok, false);
  assert.equal(service.deleteProduct(state, product.id, { expectedRevision: product.revision }, actor, admin.logOperation).status, 404);
  assert.equal(state.adminOperationLogs[0].action, "product.delete");
});

test("deletion requires current revision and pure-points permission", () => {
  const state = createSeed(), product = state.products[0]; product.purePointsOnly = true;
  const input = { expectedRevision: product.revision || 0 };
  const before = JSON.stringify(state);
  assert.equal(service.deleteProduct(state, product.id, input, { role: { permissions: ["product:write"] } }, admin.logOperation).status, 403);
  assert.equal(service.deleteProduct(state, product.id, {}, actor, admin.logOperation).status, 409);
  assert.equal(JSON.stringify(state), before);
});

test("category deletion rejects occupied/protected categories and persists empty-category removal", () => {
  const state = createSeed();
  assert.equal(service.deleteCategory(state, "水果", actor, admin.logOperation).status, 409);
  assert.equal(service.deleteCategory(state, "买商品送会员", actor, admin.logOperation).status, 400);
  assert.equal(service.deleteCategory(state, "日用", { role: { permissions: [] } }, admin.logOperation).status, 403);
  assert.equal(service.deleteCategory(state, "日用", actor, admin.logOperation).ok, true);
  assert.equal(service.listCategories(state).some(item => item.name === "日用"), false);
  assert.equal(catalog.getHome(state, state.users[0]).categories.includes("日用"), false);
  assert.equal(admin.createProduct(state, { name: "test", category: "日用", reason: "test" }, actor).status, 400);
  assert.equal(service.deleteCategory(state, "日用", actor, admin.logOperation).status, 404);
});

test("sorting, deletion and category tombstones survive SQLite reload", () => {
  const state = createSeed(), id = state.products.at(-1).id, removed = state.products[0].id;
  move(state, id, 1);
  service.deleteProduct(state, removed, { expectedRevision: 0 }, actor, admin.logOperation);
  service.deleteCategory(state, "日用", actor, admin.logOperation);
  saveSQLiteState(state, ":memory:");
  const restored = loadSQLiteState(":memory:");
  assert.equal(repo.listVisible(restored)[0].id, id);
  assert.equal(repo.findActiveById(restored, removed), null);
  assert.ok(repo.findById(restored, removed).deletedAt);
  assert.equal(service.listCategories(restored).some(item => item.name === "日用"), false);
});

test("new products go to the top without destroying saved order", () => {
  const state = createSeed(), id = state.products.at(-1).id;
  move(state, id, 1);
  const result = admin.createProduct(state, { name: "新商品", reason: "草稿" }, actor);
  assert.equal(result.ok, true);
  assert.equal(repo.listVisible(state)[0].id, result.product.id);
  assert.equal(repo.listVisible(state)[1].id, id);
});

test("catalog mutation routes authenticate before consuming body and enforce product permissions", async () => {
  const state = createSeed();
  async function request(method, url, roleId, body = {}) {
    const headers = {}; let reads = 0, response;
    if (roleId) {
      const token = issueToken({ type: "admin", roleId });
      const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url"));
      state.authSessions.push({ subjectType: "admin", subjectId: roleId, tokenId: payload.tokenId, expiresAt: new Date(payload.exp * 1000).toISOString() });
      headers.authorization = `Bearer ${token}`;
    }
    await handleAdminRoutes({ state, req: { method, headers }, url: new URL("http://localhost" + url), readBody: async () => { reads++; return body; }, send: (_, status, data) => { response = { status, data }; } });
    return { ...response, reads };
  }
  const path = `/api/admin/products/${state.products[0].id}`;
  for (const [method, url] of [["DELETE", path], ["PATCH", path + "/position"], ["DELETE", "/api/admin/product-categories"]]) {
    const absent = await request(method, url, null);
    assert.equal(absent.status, 401); assert.equal(absent.reads, 0);
    const forbidden = await request(method, url, "customer_service");
    assert.equal(forbidden.status, 403); assert.equal(forbidden.reads, 0);
  }
  assert.equal((await request("GET", "/api/admin/product-categories", "product_admin")).status, 200);
  assert.equal((await request("PATCH", path + "/position", "product_admin", { position: 2, expectedOrder: repo.listVisible(state).map(item => item.id), expectedRevision: 0 })).status, 200);
  assert.equal((await request("DELETE", path, "product_admin", { expectedRevision: 0 })).status, 200);
  assert.equal((await request("DELETE", "/api/admin/product-categories", "product_admin", { name: "日用" })).status, 200);
});
