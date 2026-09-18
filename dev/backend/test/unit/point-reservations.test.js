process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const payments = require("../../src/services/payment-service");
const orders = require("../../src/services/user-order-service");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");

function fixture() {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  user.points = 100;
  const product = state.products.find(item => item.id === "p_apple");
  product.pointsPrice = 200;
  const payload = { paymentMode: "points_plus_cash", items: [{ productId: product.id, quantity: 1 }] };
  return { state, user, product, payload };
}

test("pending mixed orders cannot reserve the same points twice", () => {
  const { state, user, payload } = fixture();
  const first = createOrder(state, user.id, payload).order;
  const second = createOrder(state, user.id, payload).order;
  assert.equal(first.pointAmount, 100);
  assert.equal(second.pointAmount, 0);
  assert.equal(user.points, 0);
  const payment = payments.createGoodsPayment(state, first.id).payment;
  assert.equal(payments.mockPaymentCallback(state, payment.payNo).ok, true);
  assert.equal(user.points, 0);
  assert.equal(first.pointsReserved, false);
  assert.equal(payments.mockPaymentCallback(state, payment.payNo).idempotent, true);
  assert.equal(user.points, 0);
});

test("SQLite preserves reservations and cancellation releases once", async () => {
  const { state, user, payload } = fixture();
  const order = createOrder(state, user.id, payload).order;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-hold-"));
  const dbFile = path.join(directory, "state.sqlite");
  saveSQLiteState(state, dbFile);
  const restored = loadSQLiteState(dbFile);
  assert.equal(restored.orders.find(item => item.id === order.id).pointsReserved, true);
  assert.equal((await orders.cancel(restored, user.id, order.id)).ok, true);
  assert.equal((await orders.cancel(restored, user.id, order.id)).idempotent, true);
  assert.equal(restored.users.find(item => item.id === user.id).points, 100);
  assert.equal(restored.pointLedger.filter(item => item.idempotencyKey === `order:${order.id}:release_points`).length, 1);
});

test("payment initiation excludes concurrent cancellation and new payment creation", async () => {
  const { state, user, payload } = fixture();
  const order = createOrder(state, user.id, payload).order;
  const payment = payments.createGoodsPayment(state, order.id).payment;
  let respond;
  const operation = payments.initiateLfwinPayment(state, payment.payNo, {}, { createPayment: () => new Promise(resolve => { respond = resolve; }) });
  assert.equal((await orders.cancel(state, user.id, order.id)).status, 409);
  assert.equal(payments.createGoodsPayment(state, order.id).status, 409);
  respond({ orderid: "real-provider-order" });
  assert.equal((await operation).ok, true);
  payments.cancelTimedOutPayments(state, { now: "2999-01-01T00:00:00Z" });
  assert.equal(order.status, "pending_payment");
  assert.equal(order.pointsReserved, true);
});

test("fully covered mixed order settles without creating a zero-value cash payment", () => {
  const { state, user, payload } = fixture();
  user.points = 250;
  const order = createOrder(state, user.id, payload).order;
  assert.equal(order.status, "paid");
  assert.equal(order.cashAmount, 0);
  assert.equal(user.points, 50);
  assert.equal(state.paymentLedger.some(item => item.orderId === order.id), false);
});

test("legacy insufficient balance never becomes falsely settled", () => {
  const { state, user, payload } = fixture();
  const order = createOrder(state, user.id, payload).order;
  order.pointsReserved = false;
  const payment = payments.createGoodsPayment(state, order.id).payment;
  assert.equal(payments.mockPaymentCallback(state, payment.payNo).ok, false);
  assert.equal(payment.status, "pending");
  assert.equal(order.status, "pending_payment");
  assert.equal(user.points, 0);
});
