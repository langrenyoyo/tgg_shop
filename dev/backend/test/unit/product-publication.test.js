process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const admin = require("../../src/services/admin-service");
const catalog = require("../../src/services/catalog-service");
const { createOrder } = require("../../src/domain/rules");
const { loadSQLiteState, saveSQLiteState } = require("../../src/data/sqlite-store");
const actor = state => ({ role: state.roles.find(item => item.id === "product_admin") });
const valid = { name: "闭环测试商品", category: "水果", image: "/assets/apple.jpg", stock: 10, pointsPrice: 10, cashPrice: 1.5, unit: "500g / 盒", description: "冷藏保存\n开封即食", reason: "商品上架测试" };

test("draft -> edit -> publish -> purchase -> unpublish closes catalog and stock flow", () => {
  const state = createSeed();
  const staff = actor(state);
  const draft = admin.createProduct(state, { name: "待完善商品", reason: "保存草稿" }, staff);
  assert.equal(draft.ok, true);
  assert.equal(draft.product.status, "off");
  const id = draft.product.id;
  assert.equal(catalog.getProduct(state, id), null);
  assert.ok(!catalog.getHome(state, state.users[0]).recommendProducts.some(item => item.id === id));
  const incomplete = admin.updateProduct(state, id, { status: "on", reason: "尝试发布" }, staff);
  assert.equal(incomplete.status, 400);
  assert.equal(draft.product.status, "off");
  const published = admin.updateProduct(state, id, { ...valid, expectedStock: 0, expectedRevision: 1, status: "on" }, staff);
  assert.equal(published.ok, true);
  assert.ok(catalog.listProducts(state).some(item => item.id === id));
  assert.equal(catalog.getProduct(state, id).description, valid.description);
  const order = createOrder(state, "u_1001", { paymentMode: "pure_points", fulfillmentType: "pickup", items: [{ productId: id, quantity: 2 }] });
  assert.equal(order.ok, true);
  assert.equal(published.product.stock, 8);
  assert.equal(admin.updateProduct(state, id, { stock: 15, expectedStock: 10, reason: "过时盘点" }, staff).status, 409);
  assert.equal(published.product.stock, 8);
  assert.equal(admin.updateProduct(state, id, { cashPrice: 2, reason: "在线改价" }, staff).status, 409);
  assert.equal(admin.updateProduct(state, id, { status: "off", reason: "停止销售" }, staff).ok, true);
  assert.equal(catalog.getProduct(state, id), null);
  assert.ok(!catalog.listProducts(state).some(item => item.id === id));
  assert.ok(!catalog.getHome(state, state.users[0]).recommendProducts.some(item => item.id === id));
  assert.equal(createOrder(state, "u_1001", { paymentMode: "pure_points", fulfillmentType: "pickup", items: [{ productId: id, quantity: 1 }] }).ok, false);
  assert.ok(state.orders.some(item => item.id === order.order.id));
  assert.ok(state.inventoryLedger.some(item => item.productId === id && item.quantityDelta === -2));
  assert.ok(state.adminOperationLogs.some(item => item.targetId === id && item.action === "product.publish"));
});

test("invalid product mutations are rejected atomically and field permissions are enforced", () => {
  const state = createSeed();
  const staff = actor(state);
  const onlyProduct = { role: { id: "restricted", permissions: ["product:read", "product:write"] } };
  assert.equal(admin.createProduct(state, valid, onlyProduct).status, 403);
  assert.equal(admin.createProduct(state, { ...valid, stock: 0, purePointsOnly: true }, onlyProduct).status, 403);
  assert.equal(admin.updateProduct(state, "p_apple", { stock: 200, expectedStock: 126, reason: "调整" }, onlyProduct).status, 403);
  const snapshot = JSON.stringify(state);
  for (const invalid of [{ stock: -1 }, { stock: 1.2 }, { pointsPrice: null }, { cashPrice: 1.234 }, { image: "javascript:alert(1)" }]) {
    assert.equal(admin.createProduct(state, { ...valid, ...invalid }, staff).status, 400);
  }
  assert.equal(admin.updateProduct(state, "p_apple", { status: "off", stock: -1, expectedStock: 126, reason: "无效修改" }, staff).status, 400);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(admin.updateProduct(state, "p_apple", { stock: 0, expectedStock: 126, reason: "盘点售罄" }, { role: { id: "stock", permissions: ["stock:write"] } }).ok, true);
  assert.equal(state.products.find(item => item.id === "p_apple").status, "on");
});

test("pure points publishing and product details survive SQLite reload", () => {
  const state = createSeed();
  const result = admin.createProduct(state, { ...valid, purePointsOnly: true, status: "on" }, actor(state));
  assert.equal(result.ok, true);
  assert.equal(result.product.supportsCash, false);
  assert.equal(result.product.cashPrice, null);
  assert.ok(catalog.listPointsExchangeProducts(state).some(item => item.id === result.product.id));
  saveSQLiteState(state, ":memory:");
  const restored = loadSQLiteState(":memory:");
  const product = catalog.getProduct(restored, result.product.id);
  assert.equal(product.description, valid.description);
  assert.equal(product.unit, valid.unit);
  assert.equal(product.revision, 1);
  assert.ok(product.publishedAt);
  assert.equal(admin.updateProduct(restored, product.id, { status: "off", expectedRevision: 0, reason: "过期编辑" }, actor(restored)).status, 409);
  const order = createOrder(restored, "u_1002", { paymentMode: "pure_points", fulfillmentType: "pickup", items: [{ productId: product.id, quantity: 1 }] });
  assert.equal(order.ok, true);
});
