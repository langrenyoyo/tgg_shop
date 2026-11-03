process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const payments = require("../../src/services/payment-service");
const { handleOrderRoutes } = require("../../src/routes/order-routes");

function legacy(state) {
  const payment = { id: "old-member", payNo: "OLD_MEMBER", userId: "u_1002", payScene: "member_open", direction: "in", amount: 19.9, status: "pending", channel: "lfwin_wechat_mini", metadata: { months: 1, paymentMode: "cash", lfwin: { providerOrderNo: "provider-old", submissionState: "submitted" } } };
  state.paymentLedger.push(payment);
  return payment;
}

test("both membership endpoints reject cash, mixed and omitted modes without mutations", async () => {
  const state = createSeed();
  state.config.membershipMonthlyPrice = 0; // Neither zero price nor client channel reopens the path.
  for (const endpoint of ["/api/member/payments", "/api/member/subscribe"]) {
    for (const paymentMode of [undefined, "cash", "points_plus_cash", "invalid"]) {
      const before = JSON.stringify(state);
      let response;
      await handleOrderRoutes({ req: { method: "POST" }, url: new URL(endpoint, "http://localhost"), state, user: state.users[0], readBody: async () => ({ paymentMode, channel: "points", autoPay: true }), send: (_, status, body) => { response = { status, body }; } });
      assert.equal(response.status, 403);
      assert.equal(JSON.stringify(state), before);
    }
  }
});

test("historical membership cannot initiate or mock pay but trusted query settles once", async () => {
  const state = createSeed();
  const payment = legacy(state);
  const user = state.users.find(item => item.id === payment.userId);
  user.memberUntil = null;
  const before = JSON.stringify(state);
  for (const method of ["wechat_mini", "qrcode"]) {
    assert.equal((await payments.initiateLfwinPayment(state, payment.payNo, { method }, { createPayment() { assert.fail("Must not contact payment creation provider"); } })).status, 403);
  }
  assert.equal(payments.mockPaymentCallback(state, payment.payNo).status, 403);
  assert.equal(JSON.stringify(state), before);
  const client = { verifyNotification: () => true, queryPayment: async () => ({ mch_orderid: payment.payNo, orderid: "provider-old", paystatus: "1", paymoney: "19.90" }) };
  assert.equal((await payments.queryLfwinPayment(state, payment.payNo, client)).ok, true);
  assert.equal(payment.status, "paid");
  const until = user.memberUntil;
  assert.ok(Date.parse(until) > Date.now());
  assert.equal((await payments.queryLfwinPayment(state, payment.payNo, client)).ok, true);
  assert.equal(user.memberUntil, until);
});

test("legacy cash key cannot be replayed as points membership", () => {
  const state = createSeed(), payment = legacy(state);
  payment.idempotencyKey = "old-key";
  state.config.membershipMonthlyPoints = 1;
  const before = JSON.stringify(state);
  assert.equal(payments.createMemberPayment(state, state.users.find(user => user.id === payment.userId), { paymentMode: "pure_points", idempotencyKey: "old-key" }).status, 409);
  assert.equal(JSON.stringify(state), before);
});

test("native payment helper blocks historical membership before any request or native payment", async () => {
  const context = { module: { exports: {} }, require: () => ({ request() { assert.fail("Must not issue a payment request"); } }), wx: { requestPayment() { assert.fail("Must not invoke native payment"); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/payment.js"), "utf8"), context);
  await assert.rejects(context.module.exports.pay({ payNo: "old", payScene: "member_open", status: "pending" }), /已停止会员直接付费/);
});
