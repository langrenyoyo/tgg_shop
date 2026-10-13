// Standalone acceptance audit; expected failures remain outside the default suite.
// Uses synthetic memory state only and replaces the withdrawal transport.
process.env.TGG_STORE_MODE = "memory";
process.env.TGG_STORE_DRIVER = "json";
process.env.TGG_LOAD_DOTENV = "0";
process.env.TGG_AUTH_SECRET = "isolated-readiness-audit-secret";
delete process.env.TGG_DEMO_PASSWORD;
delete process.env.TGG_DEMO_PASSWORD_HASH;

const test = require("node:test");
const assert = require("node:assert/strict");
const { resetState } = require("../../src/data/store");
const admin = require("../../src/services/admin-service");
const account = require("../../src/services/account-service");
const auth = require("../../src/services/auth-service");
const { createOrder } = require("../../src/domain/rules");
const huifu = require("../../src/services/withdrawal-provider/huifu-bafang");
const withdrawal = require("../../src/services/withdrawal-service");
const monthly = require("../../src/services/monthly-point-reward-service");

function fresh() {
  const state = resetState();
  state.users[0].memberUntil = new Date(Date.now() + 86400000).toISOString();
  return state;
}

test("A01 production rejects the shared demonstration login", t => {
  const previous = process.env.NODE_ENV;
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  process.env.NODE_ENV = "production";
  const state = fresh();
  const result = auth.login(state, { userId: state.users[0].id, password: "123456" });
  assert.equal(Boolean(result.ok), false, "Production issued a session for the shared demo password");
});

test("A02 monthly ranking excludes previous-month points", () => {
  const state = fresh();
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));
  state.pointLedger = [
    { userId: state.users[0].id, direction: "in", changeType: "task_reward", points: 100, createdAt: previous.toISOString() },
    { userId: state.users[0].id, direction: "in", changeType: "task_reward", points: 5, createdAt: now.toISOString() }
  ];
  assert.equal(account.getRanking(state, state.users[0].id).currentUser.score, 5);
});

test("A03 withdrawal provider receives the net amount after the configured fee", async t => {
  const configured = huifu.isConfigured;
  const submit = huifu.submit;
  t.after(() => { huifu.isConfigured = configured; huifu.submit = submit; });
  let captured;
  huifu.isConfigured = () => true;
  huifu.submit = async input => {
    captured = input;
    return { ok: true, body: { code: 200, data: { platform_order_id: "audit-only" } } };
  };
  const state = fresh();
  state.config.withdrawFeeRate = 0.01;
  const result = account.requestWithdrawal(state, state.users[0], { amount: 100, idempotencyKey: "audit-fee" });
  assert.equal(result.ok, true);
  assert.equal(result.withdrawal.arrivalAmount, 99);
  result.withdrawal.status = "approved";
  assert.equal((await withdrawal.submitWithdrawal(state, result.withdrawal.id)).ok, true);
  assert.equal(captured.transfer_amount, 9900, "Expected 99 yuan net payout in cents");
});

test("A04 invalid financial configuration is rejected without changing state", () => {
  const state = fresh();
  const before = structuredClone(state.config);
  const result = admin.updateConfig(state, { withdrawFeeRate: 2, membershipMonthlyPrice: -1 }, { role: { id: "super_admin", permissions: ["*"] } });
  assert.deepEqual({ rejected: result.ok === false, unchanged: JSON.stringify(state.config) === JSON.stringify(before) }, { rejected: true, unchanged: true });
});

test("A05 delivery rejects an out-of-range saved address", () => {
  const state = fresh();
  const address = account.createAddress(state, state.users[0].id, {
    receiverName: "Audit", mobile: "13800000000", detail: "Outside delivery area", inServiceRange: false
  });
  const result = createOrder(state, state.users[0].id, {
    paymentMode: "cash", fulfillmentType: "delivery", addressId: address.id,
    deliveryAddress: address.detail, deliveryTimeSlot: state.config.deliveryTimeSlots[0],
    items: [{ productId: "p_apple", quantity: 1 }]
  });
  assert.equal(result.ok, false, "Out-of-range delivery was accepted");
});

test("A06 purchase limit rejects a single order above the documented 500 yuan daily maximum", () => {
  const state = fresh();
  const product = state.products.find(item => item.id === "p_apple");
  Object.assign(product, { cashPrice: 501, stock: 10, status: "on", supportsCash: true });
  const result = createOrder(state, state.users[0].id, {
    paymentMode: "cash", items: [{ productId: product.id, quantity: 1 }]
  });
  assert.equal(result.ok, false, "A 501 yuan order was accepted");
});

test("A07 a reused withdrawal key rejects a different amount", () => {
  const state = fresh();
  assert.equal(account.requestWithdrawal(state, state.users[0], { amount: 10, idempotencyKey: "audit-withdraw-intent" }).ok, true);
  const result = account.requestWithdrawal(state, state.users[0], { amount: 20, idempotencyKey: "audit-withdraw-intent" });
  assert.equal(result.ok, false, "Changed withdrawal intent was silently treated as the original request");
});

test("A08 fee configuration cannot produce negative net withdrawal amounts", () => {
  const state = fresh();
  admin.updateConfig(state, { withdrawFeeRate: 2 }, { role: { id: "super_admin", permissions: ["*"] } });
  const result = account.requestWithdrawal(state, state.users[0], { amount: 10, idempotencyKey: "audit-negative-net" });
  assert.equal(result.ok && result.withdrawal.arrivalAmount < 0, false, "Negative net withdrawal accepted and balance frozen");
});

test("A09 monthly reward uses Beijing calendar month boundaries", () => {
  const state = fresh();
  state.pointLedger = [{ userId: state.users[0].id, direction: "in", changeType: "task_reward", points: 500, createdAt: "2026-09-30T16:30:00.000Z" }];
  const row = monthly.buildMonthlyPointRewardOverview(state, { monthKey: "2026-10" }).rows.find(item => item.userId === state.users[0].id);
  assert.equal(row.totalPoints, 500, "October 1 00:30 Beijing was not counted in October");
});

test("A10 automatic settlement respects the configured time", () => {
  const state = fresh();
  Object.assign(state.config, { monthlyPointRewardEnabled: true, monthlyPointRewardSettlementHour: 23, monthlyPointRewardSettlementMinute: 59 });
  state.pointLedger = [{ userId: state.users[0].id, direction: "in", changeType: "task_reward", points: 500, createdAt: "2026-09-15T12:00:00.000Z" }];
  const result = monthly.settleMonthlyPointRewards(state, { now: new Date("2026-10-01T01:00:00.000Z"), reason: "monthly reward sweep:interval" });
  assert.equal(result.appliedCount, 0, "Award issued at 09:00 Beijing before the configured 23:59 settlement");
});
