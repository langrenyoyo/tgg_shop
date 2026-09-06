const test = require("node:test");
const assert = require("node:assert/strict");
const { createLfwinClient, canonicalize, signPayload } = require("../../src/services/lfwin-payment-client");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const paymentService = require("../../src/services/payment-service");

const config = {
  baseUrl: "https://api2uat.lfwin.com",
  apiKey: "test-key",
  signKey: "test-sign-key",
  signType: "MD5"
};

test("LFWin signs canonical form fields and verifies a notification", () => {
  assert.equal(canonicalize({ money: "1.00", apikey: "test-key", sign: "ignored" }), "apikey=test-key&money=1.00");
  const signed = signPayload(config, { service: "pay.comm.qrcode", apikey: "test-key", money: "1.00", nonce_str: "nonce" });
  const client = createLfwinClient({ config });
  assert.equal(client.verifyNotification(signed), true);
  assert.equal(client.verifyNotification({ ...signed, money: "2.00" }), false);
});

test("LFWin payment creation keeps credentials server-side and sends a signed form", async () => {
  let captured;
  const client = createLfwinClient({
    config,
    request: async (url, fields) => {
      captured = { url, fields };
      return signPayload(config, { status: "10000", orderid: "LF_001", qr_code: "weixin://pay" });
    }
  });
  const response = await client.createPayment({ amount: 19.9, merchantOrderNo: "PAY_001", notifyUrl: "https://shop.example/notify" });
  assert.equal(response.orderid, "LF_001");
  assert.equal(captured.url, "https://api2uat.lfwin.com/payapi/pay/qrcode");
  assert.equal(captured.fields.money, "19.90");
  assert.equal(captured.fields.mch_orderid, "PAY_001");
  assert.equal(captured.fields.apikey, "test-key");
  assert.equal(captured.fields.sign_type, "MD5");
  assert.ok(captured.fields.sign);
});

test("LFWin callback settles only the matching payment once", () => {
  const state = createSeed();
  const orderResult = createOrder(state, "u_1001", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });
  const paymentResult = paymentService.createGoodsPayment(state, orderResult.order.id, { idempotencyKey: "lfwin-callback-test" });
  const payment = paymentResult.payment;
  payment.metadata.lfwin = { providerOrderNo: "LF_002" };
  const payload = {
    mch_orderid: payment.payNo,
    orderid: "LF_002",
    trade_no: "TRADE_002",
    paystatus: "1",
    paymoney: String(payment.amount),
    pri_paymoney: String(payment.amount)
  };
  const client = { verifyNotification: () => true };
  const settled = paymentService.applyLfwinPaymentNotification(state, payload, client);
  assert.equal(settled.ok, true);
  assert.equal(payment.status, "paid");
  assert.equal(orderResult.order.status, "paid");
  const repeat = paymentService.applyLfwinPaymentNotification(state, payload, client);
  assert.equal(repeat.ok, true);
  assert.equal(repeat.idempotent, true);
});

test("LFWin callback rejects an amount mismatch", () => {
  const state = createSeed();
  const orderResult = createOrder(state, "u_1001", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });
  const payment = paymentService.createGoodsPayment(state, orderResult.order.id, { idempotencyKey: "lfwin-amount-test" }).payment;
  const result = paymentService.applyLfwinPaymentNotification(state, {
    mch_orderid: payment.payNo,
    orderid: "LF_003",
    paystatus: "1",
    paymoney: "0.01"
  }, { verifyNotification: () => true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Payment amount mismatch");
  assert.equal(payment.status, "pending");
});
