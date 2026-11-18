process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const admin = require("../../src/services/admin-service");
const { loadSQLiteState, saveSQLiteState } = require("../../src/data/sqlite-store");
const actor = state => ({ role: state.roles.find(role => role.id === "product_admin") });
const productInput = { name: "双价商品", category: "水果", image: "/assets/apple.jpg", stock: 10, cashPrice: 12.8, regularPrice: 20, supportsPoints: false, status: "on", reason: "测试双价上架" };

test("unsubscribed and expired users cannot place cash orders, without mutations", () => {
  for (const memberUntil of [null, new Date(Date.now() - 1000).toISOString()]) {
    for (const paymentMode of ["cash", "points_plus_cash"]) {
      for (const productId of ["p_apple", "p_banana"]) {
        const state = createSeed();
        Object.assign(state.users.find(user => user.id === "u_1002"), { memberUntil, points: 10000 });
        const before = JSON.stringify(state);
        const result = createOrder(state, "u_1002", { paymentMode, items: [{ productId, quantity: 1 }] });
        assert.equal(result.ok, false);
        assert.match(result.error, /需要有效会员/);
        assert.equal(JSON.stringify(state), before);
      }
    }
  }
});

test("pure-points redemption does not require membership", () => {
  for (const productId of ["p_apple", "p_banana"]) {
    const state = createSeed();
    const user = state.users.find(item => item.id === "u_1002");
    user.memberUntil = null;
    user.points = 10000;
    const result = createOrder(state, user.id, { paymentMode: "pure_points", items: [{ productId, quantity: 1 }] });
    assert.equal(result.ok, true);
    assert.equal(result.order.status, "paid");
  }
});

test("publishing requires both prices, and invalid regular prices are rejected atomically", () => {
  for (const regularPrice of [undefined, null, 0, -1, 1.234, "", "  ", "a".repeat(121), {}, true, Infinity]) {
    const state = createSeed();
    const before = JSON.stringify(state);
    const input = { ...productInput, regularPrice };
    if (regularPrice === undefined) delete input.regularPrice;
    assert.equal(admin.createProduct(state, input, actor(state)).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
});

test("retail display text survives publishing, editing and SQLite reload without affecting checkout", () => {
  const state = createSeed();
  const text = '11.7元/500g · Special ¥ & <限时> "优惠"';
  const created = admin.createProduct(state, { ...productInput, regularPrice: text }, actor(state));
  assert.equal(created.ok, true);
  saveSQLiteState(state, ":memory:");
  const restored = loadSQLiteState(":memory:");
  const product = restored.products.find(item => item.id === created.product.id);
  assert.equal(product.regularPrice, text);
  const order = createOrder(restored, "u_1001", { paymentMode: "cash", items: [{ productId: product.id, quantity: 2 }] });
  assert.equal(order.ok, true);
  assert.equal(order.order.cashAmount, 25.6);
  assert.equal(admin.updateProduct(restored, product.id, { status: "off", reason: "编辑展示" }, actor(restored)).ok, true);
  assert.equal(admin.updateProduct(restored, product.id, { regularPrice: "原价 $2 / pack", status: "on", reason: "编辑展示" }, actor(restored)).ok, true);
  assert.equal(product.regularPrice, "原价 $2 / pack");
  assert.equal(product.cashPrice, 12.8);
  assert.equal(admin.createProduct(state, { ...productInput, regularPrice: "20" }, actor(state)).ok, true);
});

test("admin and storefront display retail text literally and escape HTML; mini-program retains legacy currency", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  const load = relative => {
    const context = vm.createContext({ module: { exports: {} } });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, relative), "utf8").replace(/export /g, ""), context);
    return context;
  };
  const user = load("../../../frontend/user/js/render.js");
  const editor = load("../../../frontend/admin/js/product-editor.js");
  const mini = load("../../../../wechat-miniprogram/utils/regular-price.wxs").module.exports;
  const text = '11.7元/500g & <img src=x onerror=alert(1)> "Sale"';
  const product = { ...productInput, regularPrice: text, status: "off" };
  const escaped = user.homeEscape(text);
  const html = user.regularPriceHtml(product);
  assert.ok(html.includes(escaped));
  assert.ok(!html.includes('<img'));
  const form = editor.productEditor(product, { escapeHtml: user.homeEscape, can: () => true });
  assert.match(form, /name="regularPrice" type="text"/);
  assert.ok(form.includes(escaped));
  assert.ok(editor.productPreview(product, user.homeEscape).includes(escaped));
  assert.equal(mini.display(text), text);
  assert.equal(mini.display(20), "¥20");
  assert.equal(mini.display(null), "");
  assert.equal(user.regularPriceHtml({ ...product, purePointsOnly: true }), "");
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
