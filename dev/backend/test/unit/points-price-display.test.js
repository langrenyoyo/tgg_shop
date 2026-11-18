process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const admin = require("../../src/services/admin-service");
const catalog = require("../../src/services/catalog-service");
const { createOrder } = require("../../src/domain/rules");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const actor = { role: { id: "product_admin", permissions: ["product:write", "points_product:write", "stock:write"] } };
const input = { name: "积分展示商品", category: "水果", image: "/assets/apple.jpg", stock: 10, pointsPrice: 100, purePointsOnly: true, status: "on", reason: "展示文字验证" };
const text = '100积分/500g · Points & <限时> "兑换"';

test("points display survives publishing and SQLite reload; checkout deducts numeric points only", () => {
  const state = createSeed();
  const result = admin.createProduct(state, { ...input, pointsPriceText: text }, actor);
  assert.equal(result.ok, true);
  saveSQLiteState(state, ":memory:");
  const restored = loadSQLiteState(":memory:");
  const product = catalog.getProduct(restored, result.product.id);
  assert.equal(product.pointsPriceText, text);
  assert.equal(product.pointsPrice, 100);
  assert.equal(catalog.listProductPage(restored).items.find(row => row.id === product.id).pointsPriceText, text);
  const user = restored.users[1]; user.points = 1000; user.memberUntil = null;
  const order = createOrder(restored, user.id, { paymentMode: "pure_points", items: [{ productId: product.id, quantity: 2, pointsPrice: 1, pointsPriceText: "1积分" }] });
  assert.equal(order.ok, true);
  assert.equal(order.order.pointAmount, 200);
  assert.equal(order.order.cashAmount, 0);
  assert.equal(user.points, 800);
});

test("display text cannot bypass valid settlement points, stock or product permissions", () => {
  for (const pointsPrice of [0, -1, 1.5, "100", NaN]) {
    const state = createSeed(), before = JSON.stringify(state);
    assert.equal(admin.createProduct(state, { ...input, pointsPrice, pointsPriceText: "100积分/500g" }, actor).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
  for (const pointsPriceText of [123, null, {}, "x".repeat(121)]) {
    assert.equal(admin.createProduct(createSeed(), { ...input, pointsPriceText }, actor).status, 400);
  }
  const state = createSeed();
  const product = admin.createProduct(state, { ...input, pointsPriceText: text }, actor).product;
  assert.equal(admin.updateProduct(state, product.id, { pointsPriceText: "Sale", reason: "修改" }, actor).status, 409);
  assert.equal(admin.updateProduct(state, product.id, { status: "off", reason: "修改" }, actor).ok, true);
  assert.equal(admin.updateProduct(state, product.id, { pointsPriceText: "Sale", reason: "修改" }, { role: { permissions: ["product:write"] } }).status, 403);
  assert.equal(admin.updateProduct(state, product.id, { pointsPriceText: "  Points × 100  ", reason: "修改" }, actor).ok, true);
  assert.equal(product.pointsPriceText, "Points × 100");
  assert.equal(product.pointsPrice, 100);
  assert.equal(admin.updateProduct(state, product.id, { pointsPriceText: "", status: "on", reason: "清空展示" }, actor).ok, true);
});

test("mixed payment and insufficient balance use numeric price regardless of display text", () => {
  const state = createSeed();
  const result = admin.createProduct(state, { ...input, purePointsOnly: false, cashPrice: 10, regularPrice: "12元", pointsPriceText: "兑换 Special / 500g" }, actor);
  assert.equal(result.ok, true);
  const user = state.users[0]; user.points = 30; user.memberUntil = new Date(Date.now() + 86400000).toISOString();
  const before = JSON.stringify(state);
  assert.equal(createOrder(state, user.id, { paymentMode: "pure_points", items: [{ productId: result.product.id, quantity: 1 }] }).ok, false);
  assert.equal(JSON.stringify(state), before);
  const mixed = createOrder(state, user.id, { paymentMode: "points_plus_cash", items: [{ productId: result.product.id, quantity: 2 }] });
  assert.equal(mixed.ok, true);
  assert.equal(mixed.order.pointAmount, 30);
  assert.equal(mixed.order.cashAmount, 17);
});

test("display text is escaped in web/admin, preserved in mini-program and excluded from totals", () => {
  const load = relative => {
    const context = vm.createContext({ module: { exports: {} } });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, relative), "utf8").replace(/export /g, ""), context);
    return context;
  };
  const web = load("../../../frontend/user/js/render.js");
  const editor = load("../../../frontend/admin/js/product-editor.js");
  const mini = load("../../../../wechat-miniprogram/utils/regular-price.wxs").module.exports;
  const product = { ...input, pointsPriceText: '<img src=x onerror=alert(1)> "100积分/500g" & Sale', quantity: 2, status: "off" };
  const escaped = web.homeEscape(product.pointsPriceText);
  assert.equal(web.productPriceText(product, true), escaped);
  assert.equal(web.lineTotalText(product), "200积分");
  assert.ok(editor.productPreview(product, web.homeEscape).includes(escaped));
  const form = editor.productEditor(product, { escapeHtml: web.homeEscape, can: () => true });
  assert.ok(form.includes(escaped));
  assert.match(form, /name="pointsPriceText" type="text"/);
  assert.match(form, /name="pointsPrice" type="number"/);
  assert.equal(mini.points(product), product.pointsPriceText);
  assert.equal(mini.points({ pointsPrice: 100 }), "100 积分");
  assert.equal(mini.points({ pointsPrice: 100, pointsPriceText: "" }), "100 积分");
  assert.equal(web.productPriceText({ pointsPrice: 100 }, true), "100积分");
  assert.notEqual(web.homeSignature({ products: [product] }), web.homeSignature({ products: [{ ...product, pointsPriceText: "new" }] }));
});
