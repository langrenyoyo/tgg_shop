process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const admin = require("../../src/services/admin-service");
const { createOrder } = require("../../src/domain/rules");
const payments = require("../../src/services/payment-service");
const refunds = require("../../src/domain/refund-rules");
const { grantMembership, revokeMembership } = require("../../src/domain/product-membership");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const actor = { role: { id: "product_admin", permissions: ["product:write", "stock:write"] } };
const DAY = 86400000;
const input = { name: "鲜果礼包", category: "买商品送会员", image: "/assets/apple.jpg", cashPrice: 20, regularPrice: 25, stock: 20, status: "on", reason: "买实物赠会员" };
function setup() {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1002");
  Object.assign(user, { memberUntil: null, role: "normal" });
  const result = admin.createProduct(state, input, actor);
  assert.equal(result.ok, true, result.error);
  return { state, user, product: result.product };
}
function orderFor(state, user, product, extra = {}) {
  const result = createOrder(state, user.id, { paymentMode: "cash", items: [{ productId: product.id, quantity: 2 }], ...extra });
  assert.equal(result.ok, true, result.error);
  return result.order;
}
function settle(state, order) {
  const payment = payments.createGoodsPayment(state, order.id, { channel: "lfwin_wechat_mini" }).payment;
  const payload = { mch_orderid: payment.payNo, orderid: `provider-${order.id}`, paystatus: "1", paymoney: String(payment.amount) };
  const result = payments.applyLfwinPaymentNotification(state, payload, { verifyNotification: () => true });
  assert.equal(result.ok, true, result.error);
  return { payment, payload };
}

test("gift product creation uses product permissions, defaults to 30 days and cash only", () => {
  const { product } = setup();
  assert.equal(product.membershipGiftDays, 30);
  assert.equal(product.supportsPoints, false);
  for (const membershipGiftDays of [-1, 0, 366, 1.5, "30"]) {
    const state = createSeed(), before = JSON.stringify(state);
    assert.equal(admin.createProduct(state, { ...input, membershipGiftDays }, actor).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
  assert.equal(admin.createProduct(createSeed(), input, { role: { permissions: ["stock:write"] } }).status, 403);
  assert.equal(admin.createProduct(createSeed(), { ...input, purePointsOnly: true }, actor).ok, false);
  assert.equal(admin.createProduct(createSeed(), { ...input, category: "水果", membershipGiftDays: 30 }, actor).ok, false);
  const state = createSeed();
  const ordinary = admin.createProduct(state, { ...input, category: "水果", status: "off" }, actor).product;
  assert.equal(ordinary.membershipGiftDays, 0);
  const moved = admin.updateProduct(state, ordinary.id, { category: "买商品送会员", reason: "加入专区" }, actor);
  assert.equal(moved.ok, true, moved.error);
  assert.equal(moved.product.membershipGiftDays, 30);
  assert.equal(moved.product.supportsPoints, false);
});

test("nonmember gift order snapshots quantity and grants once only after valid provider payment", () => {
  const { state, user, product } = setup();
  const order = orderFor(state, user, product, { membershipGiftDays: 999, cashAmount: 0.01 });
  assert.equal(order.cashAmount, 40);
  assert.equal(order.membershipGiftDays, 60);
  assert.equal(user.memberUntil, null);
  product.membershipGiftDays = 90;
  const payment = payments.createGoodsPayment(state, order.id, { channel: "lfwin_wechat_mini" }).payment;
  const bad = payments.applyLfwinPaymentNotification(state, { mch_orderid: payment.payNo, paystatus: "1", paymoney: "0.01" }, { verifyNotification: () => true });
  assert.equal(bad.ok, false);
  assert.equal(user.memberUntil, null);
  const { payload } = settle(state, order);
  const end = user.memberUntil;
  assert.equal(Date.parse(end) - Date.parse(order.membershipGift.startsAt), 60 * DAY);
  assert.equal(user.role, "member");
  assert.equal(payments.applyLfwinPaymentNotification(state, payload, { verifyNotification: () => true }).ok, true);
  assert.equal(user.memberUntil, end);
});

test("nonmember cannot use an activity item to buy ordinary goods or exchange with points", () => {
  const { state, user, product } = setup();
  const before = JSON.stringify(state);
  for (const paymentMode of ["pure_points", "points_plus_cash"]) {
    assert.equal(createOrder(state, user.id, { paymentMode, items: [{ productId: product.id, quantity: 1 }] }).ok, false);
  }
  assert.equal(createOrder(state, user.id, { paymentMode: "cash", items: [{ productId: product.id, quantity: 1 }, { productId: "p_apple", quantity: 1 }] }).ok, false);
  assert.equal(JSON.stringify(state), before);
});

test("nonmember activity purchase supports delivery including its configured fee", () => {
  const { state, user, product } = setup();
  const order = orderFor(state, user, product, { items: [{ productId: product.id, quantity: 1 }], fulfillmentType: "delivery", deliveryAddress: "师大测试地址" });
  assert.equal(order.deliveryFee, 3);
  assert.equal(order.cashAmount, 23);
  assert.equal(order.membershipGiftDays, 30);
});

test("existing membership extends, refund settles once and preserves the original paid period", () => {
  const { state, user, product } = setup();
  const originalEnd = new Date(Date.now() + 10 * DAY).toISOString();
  user.memberUntil = originalEnd;
  const order = orderFor(state, user, product);
  settle(state, order);
  assert.equal(Date.parse(user.memberUntil), Date.parse(originalEnd) + 60 * DAY);
  const refund = refunds.createRefundRequest(state, user.id, order.id).refundOrder;
  assert.equal(order.membershipGift.revokedAt, undefined);
  assert.equal(refunds.settleProviderRefund(state, refund.id).ok, true);
  assert.equal(user.memberUntil, originalEnd);
  const revokedAt = order.membershipGift.revokedAt;
  assert.equal(refunds.settleProviderRefund(state, refund.id).ok, true);
  assert.equal(user.memberUntil, originalEnd);
  assert.equal(order.membershipGift.revokedAt, revokedAt);
});

test("refund removes unused gift intervals and shifts subsequent gifts without consuming paid renewals", () => {
  const { state, user } = setup();
  const now = Date.now();
  const makeOrder = id => ({ id, userId: user.id, paymentMode: "cash", cashAmount: 20, status: "paid", membershipGiftDays: 30 });
  const first = makeOrder("gift-1"), second = makeOrder("gift-2");
  state.orders.push(first, second);
  grantMembership(state, first, now);
  grantMembership(state, second, now);
  user.memberUntil = new Date(Date.parse(user.memberUntil) + 30 * DAY).toISOString(); // Later paid renewal.
  revokeMembership(state, first, now + 10 * DAY);
  assert.equal(Date.parse(user.memberUntil), now + 70 * DAY);
  assert.equal(Date.parse(second.membershipGift.startsAt), now + 10 * DAY);
  revokeMembership(state, second, now + 10 * DAY);
  assert.equal(Date.parse(user.memberUntil), now + 40 * DAY);
  assert.equal(first.membershipGift.revokedMilliseconds, 20 * DAY);
  revokeMembership(state, first, now + 10 * DAY);
  assert.equal(Date.parse(user.memberUntil), now + 40 * DAY);
});

test("an already consumed gift never deducts a subsequent paid membership", () => {
  const { state, user } = setup(), now = Date.now();
  const order = { id: "old-gift", userId: user.id, paymentMode: "cash", cashAmount: 20, status: "paid", membershipGiftDays: 30 };
  state.orders.push(order);
  grantMembership(state, order, now - 40 * DAY);
  user.memberUntil = new Date(now + 30 * DAY).toISOString();
  revokeMembership(state, order, now);
  assert.equal(Date.parse(user.memberUntil), now + 30 * DAY);
  assert.equal(order.membershipGift.revokedMilliseconds, 0);
});

test("gift configuration, order snapshot and grant identity survive SQLite reload and refunds", () => {
  const { state, user, product } = setup();
  user.memberUntil = new Date(Date.now() + 5 * DAY).toISOString();
  const originalEnd = user.memberUntil;
  const order = orderFor(state, user, product);
  saveSQLiteState(state, ":memory:");
  const restored = loadSQLiteState(":memory:");
  assert.equal(restored.products.find(item => item.id === product.id).membershipGiftDays, 30);
  const restoredOrder = restored.orders.find(item => item.id === order.id);
  assert.equal(restoredOrder.membershipGiftDays, 60);
  settle(restored, restoredOrder);
  saveSQLiteState(restored, ":memory:");
  const final = loadSQLiteState(":memory:");
  const finalOrder = final.orders.find(item => item.id === order.id);
  assert.ok(finalOrder.membershipGift.grantedAt);
  const refund = refunds.createRefundRequest(final, user.id, order.id).refundOrder;
  assert.equal(refunds.settleProviderRefund(final, refund.id).ok, true);
  assert.equal(final.users.find(item => item.id === user.id).memberUntil, originalEnd);
});

test("unpaid cancellation does not grant membership", async () => {
  const { state, user, product } = setup();
  const order = orderFor(state, user, product);
  const result = await require("../../src/services/user-order-service").cancel(state, user.id, order.id);
  assert.equal(result.ok, true);
  assert.equal(user.memberUntil, null);
  assert.equal(order.membershipGift, undefined);
});

test("native nonmember checkout can submit an activity order with the advertised gift", async () => {
  const { state, user, product } = setup();
  let page;
  const writes = [], routes = [];
  const resources = { "/api/me": { ...user, isMember: false }, "/api/products": [product], "/api/config": state.config, "/api/pickup-sites": state.pickupSites, "/api/addresses": [] };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/checkout/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("/api") ? { request: async (url, options) => {
      if (url === "/api/orders") {
        writes.push(options.data);
        const result = createOrder(state, user.id, options.data);
        if (!result.ok) throw new Error(result.error);
        return result.order;
      }
      return resources[url];
    } } : { readCheckout: () => [{ productId: product.id, quantity: 2 }], checkoutIdempotencyKey: () => "gift-checkout", readCheckoutAttempt: () => null, writeCheckoutAttempt() {}, completeCheckout() {} },
    wx: { getStorageSync: key => key === "tgg_user" ? user : "token", showToast: value => { throw new Error(value.title); }, redirectTo: value => routes.push(value.url) }
  });
  page.setData = (data, cb) => { Object.assign(page.data, data); cb?.(); };
  page.ownerId = user.id;
  page.idempotencyKey = "gift-checkout";
  await page.load();
  assert.equal(page.data.needsMembership, false);
  assert.equal(page.data.modes[0].id, "cash");
  assert.equal(page.data.membershipGiftDays, 60);
  await page.submit();
  assert.equal(writes.length, 1);
  assert.match(routes[0], /order-detail/);
  assert.equal(state.orders[0].membershipGiftDays, 60);
});
