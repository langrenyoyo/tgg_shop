process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const payments = require("../../src/services/payment-service");
const orders = require("../../src/services/user-order-service");

test("provider timeout preserves inventory and recovers paid order using merchant number", async () => {
  const state = createSeed();
  const order = createOrder(state, "u_1001", { paymentMode: "cash", items: [{ productId: "p_apple", quantity: 1 }] }).order;
  const payment = payments.createGoodsPayment(state, order.id, { channel: "lfwin_wechat_mini" }).payment;
  const stock = state.products.find(item => item.id === "p_apple").stock;
  let attempts = 0;
  const client = {
    createPayment: async () => { attempts += 1; assert.equal(payment.metadata.lfwin.submissionState, "sending"); throw new Error("response timeout"); },
    queryPayment: async input => {
      assert.equal(input.merchantOrderNo, payment.payNo);
      assert.equal(input.providerOrderNo, undefined);
      return { mch_orderid: payment.payNo, orderid: "remote-paid", paystatus: "1", paymoney: payment.amount };
    },
    verifyNotification: () => true
  };
  assert.equal((await payments.initiateLfwinPayment(state, payment.payNo, {}, client)).status, 502);
  assert.equal(payment.metadata.lfwin.submissionState, "unknown");
  assert.equal((await payments.initiateLfwinPayment(state, payment.payNo, {}, client)).status, 409);
  assert.equal(attempts, 1);
  assert.equal((await orders.cancel(state, "u_1001", order.id)).status, 409);
  payments.cancelTimedOutPayments(state, { now: Date.now() + 86400000 });
  assert.equal(order.status, "pending_payment");
  assert.equal(state.products.find(item => item.id === "p_apple").stock, stock);
  const result = await payments.queryLfwinPayment(state, payment.payNo, client);
  assert.equal(result.ok, true);
  assert.equal(payment.status, "paid");
  assert.equal(order.status, "paid");
  assert.equal(payment.metadata.lfwin.providerOrderNo, "remote-paid");
});

test("query for uncertain payment cannot bind another merchant order", async () => {
  const state = createSeed();
  const payment = payments.createMemberPayment(state, state.users[0], { channel: "lfwin_wechat_mini" }).payment;
  payment.metadata.lfwin = { submissionState: "unknown" };
  const result = await payments.queryLfwinPayment(state, payment.payNo, { queryPayment: async () => ({ mch_orderid: "someone-else", orderid: "wrong", paystatus: "0" }) });
  assert.equal(result.ok, false);
  assert.equal(payment.metadata.lfwin.providerOrderNo, undefined);
  assert.equal(payment.metadata.lfwin.submissionState, "unknown");
});
