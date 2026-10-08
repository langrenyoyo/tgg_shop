process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const admin = require("../../src/services/admin-service");
const { loadSQLiteState, saveSQLiteState } = require("../../src/data/sqlite-store");
const actor = state => ({ role: state.roles.find(role => role.id === "product_admin") });
const productInput = { name: "双价商品", category: "水果", image: "/assets/apple.jpg", stock: 10, cashPrice: 12.8, regularPrice: 20, supportsPoints: false, status: "on", reason: "测试双价上架" };

test("unsubscribed and expired users cannot order through any payment mode, without mutations", () => {
  for (const memberUntil of [null, new Date(Date.now() - 1000).toISOString()]) {
    for (const paymentMode of ["cash", "pure_points", "points_plus_cash"]) {
      for (const productId of ["p_apple", "p_banana"]) {
        const state = createSeed();
        Object.assign(state.users.find(user => user.id === "u_1002"), { memberUntil, points: 10000 });
        const before = JSON.stringify(state);
        const result = createOrder(state, "u_1002", { paymentMode, items: [{ productId, quantity: 1 }] });
        assert.equal(result.ok, false);
        assert.match(result.error, /先购买月会员/);
        assert.equal(JSON.stringify(state), before);
      }
    }
  }
});

test("publishing requires both prices, and invalid regular prices are rejected atomically", () => {
  for (const regularPrice of [undefined, null, 0, -1, 1.234, "20", Infinity]) {
    const state = createSeed();
    const before = JSON.stringify(state);
    const input = { ...productInput, regularPrice };
    if (regularPrice === undefined) delete input.regularPrice;
    assert.equal(admin.createProduct(state, input, actor(state)).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
});

test("both prices survive reload; cash checkout ignores regular and client supplied prices", () => {
  const state = createSeed();
  const created = admin.createProduct(state, productInput, actor(state));
  assert.equal(created.ok, true);
  saveSQLiteState(state, ":memory:");
  const restored = loadSQLiteState(":memory:");
  const product = restored.products.find(item => item.id === created.product.id);
  assert.equal(product.regularPrice, 20);
  assert.equal(product.cashPrice, 12.8);
  const order = createOrder(restored, "u_1001", { paymentMode: "cash", cashAmount: 0.01, items: [{ productId: product.id, quantity: 3, cashPrice: 0.01, regularPrice: 0.01 }] });
  assert.equal(order.ok, true);
  assert.equal(order.order.cashAmount, 38.4);
  assert.equal(admin.updateProduct(restored, product.id, { regularPrice: 30, reason: "在线改价" }, actor(restored)).status, 409);
  assert.equal(admin.updateProduct(restored, product.id, { status: "off", reason: "调整价格" }, actor(restored)).ok, true);
  assert.equal(admin.updateProduct(restored, product.id, { regularPrice: 30, cashPrice: 10, reason: "调整价格", status: "on" }, actor(restored)).ok, true);
  assert.equal(order.order.cashAmount, 38.4);
});
