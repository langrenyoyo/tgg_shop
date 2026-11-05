process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const account = require("../../src/services/account-service");
const admin = require("../../src/services/admin-service");

function fixture() {
  const state = createSeed();
  const user = state.users[0];
  user.points = 500;
  user.withdrawableBalance = 2;
  state.config.pointBalanceExchangeEnabled = true;
  state.config.pointBalanceExchangeRate = 0.1;
  state.config.pointBalanceExchangeMinPoints = 100;
  return { state, user };
}

test("points exchange to withdrawable balance debits and credits separate ledgers", () => {
  const { state, user } = fixture();
  const result = account.exchangePointsToBalance(state, user, { points: 200, idempotencyKey: "exchange-001" });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 20);
  assert.equal(user.points, 300);
  assert.equal(user.withdrawableBalance, 22);
  assert.equal(state.pointLedger[0].changeType, "points_to_balance_exchange");
  assert.equal(state.pointLedger[0].direction, "out");
  assert.equal(state.withdrawableLedger[0].direction, "in");
});

test("repeated exchange intent is idempotent and does not double spend", () => {
  const { state, user } = fixture();
  const input = { points: 100, idempotencyKey: "exchange-002" };
  const first = account.exchangePointsToBalance(state, user, input);
  const second = account.exchangePointsToBalance(state, user, input);
  assert.equal(first.ok, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.balance, 12);
  assert.equal(user.points, 400);
  assert.equal(user.withdrawableBalance, 12);
  assert.equal(state.pointLedger.filter(item => item.changeType === "points_to_balance_exchange").length, 1);
  assert.equal(account.exchangePointsToBalance(state, user, { points: 200, idempotencyKey: input.idempotencyKey }).status, 409);
});

test("disabled, below minimum and insufficient point exchanges are rejected", () => {
  const { state, user } = fixture();
  state.config.pointBalanceExchangeEnabled = false;
  assert.equal(account.exchangePointsToBalance(state, user, { points: 100, idempotencyKey: "exchange-003" }).status, 503);
  state.config.pointBalanceExchangeEnabled = true;
  assert.equal(account.exchangePointsToBalance(state, user, { points: 99, idempotencyKey: "exchange-004" }).status, 400);
  assert.equal(account.exchangePointsToBalance(state, user, { points: 600, idempotencyKey: "exchange-005" }).status, 400);
  assert.equal(user.points, 500);
  assert.equal(user.withdrawableBalance, 2);
});

test("administrator can configure exchange switch, rate and minimum", () => {
  const state = createSeed();
  const result = admin.updateConfig(state, {
    pointBalanceExchangeEnabled: true,
    pointBalanceExchangeRate: 0.02,
    pointBalanceExchangeMinPoints: 200,
    reason: "configure point balance exchange"
  }, { role: { id: "super_admin", permissions: ["*"] } });
  assert.equal(result.pointBalanceExchangeEnabled, true);
  assert.equal(state.config.pointBalanceExchangeEnabled, true);
  assert.equal(state.config.pointBalanceExchangeRate, 0.02);
  assert.equal(state.config.pointBalanceExchangeMinPoints, 200);
  assert.equal(admin.updateConfig(state, { pointBalanceExchangeRate: 2, reason: "invalid" }, { role: { id: "super_admin", permissions: ["*"] } }).status, 400);
});
