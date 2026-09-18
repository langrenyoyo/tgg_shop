process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const { shipOrder } = require("../../src/domain/fulfillment-rules");
const orders = require("../../src/services/user-order-service");
const payments = require("../../src/services/payment-service");
const { handleOrderRoutes } = require("../../src/routes/order-routes");

test("cancellation restores stock once and blocks later payment", async () => {
  const state = createSeed();
  const product = state.products.find(item => item.id === "p_apple");
  const stock = product.stock;
  const order = createOrder(state, "u_1001", { paymentMode: "cash", items: [{ productId: product.id, quantity: 1 }] }).order;
  const payment = payments.createGoodsPayment(state, order.id).payment;
  assert.equal((await orders.cancel(state, "u_1002", order.id)).status, 404);
  assert.equal((await orders.cancel(state, "u_1001", order.id)).ok, true);
  assert.equal(product.stock, stock);
  assert.equal((await orders.cancel(state, "u_1001", order.id)).idempotent, true);
  assert.equal(product.stock, stock);
  assert.equal(payments.mockPaymentCallback(state, payment.payNo).ok, false);
});

test("receipt requires own delivery order in shipping state", async () => {
  const state = createSeed();
  const order = createOrder(state, "u_1001", { paymentMode: "pure_points", fulfillmentType: "delivery", deliveryAddress: "测试地址", items: [{ productId: "p_banana", quantity: 1 }] }).order;
  assert.equal((await orders.receive(state, "u_1002", order.id)).status, 404);
  assert.equal((await orders.receive(state, "u_1001", order.id)).ok, false);
  const staff = state.deliveryStaff.find(item => item.enabled && state.deliveryTeams.some(team => team.id === item.teamId && team.enabled));
  assert.equal(shipOrder(state, order.id, staff.id).ok, true);
  assert.equal((await orders.receive(state, "u_1001", order.id)).ok, true);
  assert.equal(order.status, "completed");
});

test("order endpoints hide another user's order and refund details", async () => {
  const state = createSeed();
  const order = createOrder(state, "u_1001", { paymentMode: "cash", items: [{ productId: "p_apple", quantity: 1 }] }).order;
  for (const suffix of ["", "/payments", "/pay", "/refunds", "/cancel", "/receive"]) {
    let response;
    await handleOrderRoutes({ req: { method: suffix ? "POST" : "GET" }, url: new URL("http://localhost/api/orders/" + order.id + suffix), state, user: state.users.find(item => item.id === "u_1002"), send: (res, status, body) => { response = { status, body }; }, readBody: async () => ({}) });
    assert.equal(response.status, 404);
  }
});

test("native payment exposes only validated invocation fields and does not settle locally", async () => {
  const state = createSeed();
  const user = state.users[0];
  const payment = payments.createMemberPayment(state, user, { channel: "lfwin_wechat_mini", idempotencyKey: "mini-1" }).payment;
  const before = user.memberUntil;
  const result = await payments.initiateLfwinPayment(state, payment.payNo, { method: "wechat_mini" }, {
    createPayment: async () => ({ orderid: "provider-1", secret: "do-not-expose", pay_info: JSON.stringify({ timeStamp: "123456", nonceStr: "nonce", package: "prepay_id=abc", signType: "RSA", paySign: "signature", extra: "hidden" }) })
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider.requestPayment.package, "prepay_id=abc");
  assert.equal(result.provider.requestPayment.extra, undefined);
  assert.equal(result.provider.secret, undefined);
  assert.equal(payment.status, "pending");
  assert.equal(user.memberUntil, before);
});

test("production rejects simulated settlement even for a real-channel payment", () => {
  const state = createSeed();
  const payment = payments.createMemberPayment(state, state.users[0], { channel: "lfwin_wechat_mini" }).payment;
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try { assert.equal(payments.mockPaymentCallback(state, payment.payNo).status, 403); assert.equal(payment.status, "pending"); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
