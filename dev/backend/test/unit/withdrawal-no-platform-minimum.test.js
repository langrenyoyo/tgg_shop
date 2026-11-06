process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { normalizeState } = require("../../src/data/state-normalizer");
const { activeConfig } = require("../../src/config/active-config");
const { withdrawalNotice } = require("../../src/config/withdrawal-notice");
const { requestWithdrawal } = require("../../src/services/account-service");
const { updateConfig } = require("../../src/services/admin-service");

test("ordinary nonmembers can withdraw sub-yuan balances regardless of legacy platform minimums", () => {
  for (const amount of [0.1, 0.5, 0.99]) {
    const state = createSeed();
    const user = state.users[1];
    user.withdrawableBalance = amount;
    user.memberUntil = null;
    state.config.withdrawMinAmount = 100;
    const request = { amount, idempotencyKey: `small-${amount}` };
    const result = requestWithdrawal(state, user, request);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.withdrawal.amount, amount);
    assert.equal(user.withdrawableBalance, 0);
    const replay = requestWithdrawal(state, user, request);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.withdrawal.id, result.withdrawal.id);
    assert.equal(user.withdrawableBalance, 0);
  }
});

test("channel net minimum and amount precision still reject before freezing funds", () => {
  for (const amount of [0, -1, 0.001, 0.105, 0.09, NaN, Infinity]) {
    const state = createSeed();
    const user = state.users[1];
    const balance = user.withdrawableBalance;
    const count = state.withdrawRequests.length;
    const result = requestWithdrawal(state, user, { amount });
    assert.equal(result.ok, false, String(amount));
    assert.equal(user.withdrawableBalance, balance);
    assert.equal(state.withdrawRequests.length, count);
  }
  const state = createSeed();
  state.config.withdrawFeeRate = 0.1;
  assert.match(requestWithdrawal(state, state.users[1], { amount: 0.1 }).error, /渠道/);
  assert.equal(requestWithdrawal(state, state.users[1], { amount: 0.11 }).ok, true);
});

test("historical notices remove platform thresholds but retain operational and channel terms", () => {
  const notice = "最低提现金额 1 元，单笔提现 1-200 元，每日 2 次。\n1元起提。全天可提交。\n渠道要求扣除手续费后到账金额至少为 0.1 元。";
  const cleaned = withdrawalNotice(notice);
  assert.doesNotMatch(cleaned, /最低提现|1元起提|1-200/);
  assert.match(cleaned, /单笔提现上限 200 元/);
  assert.match(cleaned, /每日 2 次/);
  assert.match(cleaned, /全天可提交/);
  assert.match(cleaned, /渠道要求扣除手续费后到账金额至少为 0.1 元/);
  assert.equal(withdrawalNotice(cleaned), cleaned);
  const state = createSeed();
  state.config.withdrawMinAmount = 100;
  state.config.withdrawNotice = notice;
  const publicConfig = activeConfig(state.config);
  assert.equal(publicConfig.withdrawMinAmount, undefined);
  assert.equal(publicConfig.withdrawNotice, cleaned);
  const normalized = normalizeState(state);
  assert.equal(normalized.config.withdrawMinAmount, undefined);
  assert.equal(normalized.config.withdrawNotice, cleaned);
  assert.equal(normalized.config.withdrawDailyCountLimit, 2);
  assert.equal(normalized.config.withdrawDailyAmountLimit, 500);
});

test("admin saves cleaned notices and cannot reinstate the retired minimum", () => {
  const state = createSeed();
  const actor = { role: { id: "super_admin", permissions: ["*"] } };
  const notice = "提现最低 1 元。手续费为 1%。失败退回余额。";
  const result = updateConfig(state, { withdrawNotice: notice, reason: "取消最低金额" }, actor);
  assert.equal(result.withdrawNotice, "手续费为 1%。失败退回余额。");
  const before = JSON.stringify(state.config);
  assert.equal(updateConfig(state, { withdrawMinAmount: 1, reason: "旧客户端" }, actor).ok, false);
  assert.equal(JSON.stringify(state.config), before);
  assert.equal(updateConfig(state, { withdrawMinAmount: 0, reason: "取消" }, actor).withdrawMinAmount, undefined);
});
