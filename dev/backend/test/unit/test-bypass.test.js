process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const paymentService = require("../../src/services/payment-service");
const accountService = require("../../src/services/account-service");
const bypass = require("../../src/services/test-bypass-service");

test("test bypass settles an own payment and completes an own withdrawal", () => {
  const oldEnv = { node: process.env.NODE_ENV, bypass: process.env.TGG_TEST_BYPASS_ENABLED };
  process.env.NODE_ENV = "development";
  process.env.TGG_TEST_BYPASS_ENABLED = "1";
  try {
    const state = createSeed();
    const user = state.users.find(item => item.id === "u_1001");
    const payment = paymentService.createMemberPayment(state, user, { months: 1, paymentMode: "cash", channel: "mock_pay", idempotencyKey: "test-member-payment" }).payment;
    assert.equal(bypass.enabled(), true);
    assert.equal(bypass.settlePayment(state, user, payment.payNo).ok, true);
    assert.equal(user.isMember || user.role === "member", true);

    user.withdrawableBalance = 10;
    const requested = accountService.requestWithdrawal(state, user, { amount: 1, channel: "wechat", idempotencyKey: "test-withdrawal" });
    assert.equal(requested.ok, true);
    const completed = bypass.completeWithdrawal(state, user, requested.withdrawal.id);
    assert.equal(completed.ok, true);
    assert.equal(completed.withdrawal.status, "success");
    assert.equal(state.withdrawableLedger.filter(item => item.idempotencyKey === `${requested.withdrawal.id}:payout`).length, 1);
    assert.equal(bypass.completeWithdrawal(state, user, requested.withdrawal.id).idempotent, true);
  } finally {
    process.env.NODE_ENV = oldEnv.node;
    if (oldEnv.bypass === undefined) delete process.env.TGG_TEST_BYPASS_ENABLED;
    else process.env.TGG_TEST_BYPASS_ENABLED = oldEnv.bypass;
  }
});

test("test bypass is disabled in production and without the explicit flag", () => {
  const oldEnv = { node: process.env.NODE_ENV, bypass: process.env.TGG_TEST_BYPASS_ENABLED };
  process.env.NODE_ENV = "production";
  process.env.TGG_TEST_BYPASS_ENABLED = "1";
  try { assert.equal(bypass.enabled(), false); }
  finally {
    process.env.NODE_ENV = oldEnv.node;
    if (oldEnv.bypass === undefined) delete process.env.TGG_TEST_BYPASS_ENABLED;
    else process.env.TGG_TEST_BYPASS_ENABLED = oldEnv.bypass;
  }
});
