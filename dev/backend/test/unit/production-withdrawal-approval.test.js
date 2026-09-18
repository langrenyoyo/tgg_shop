process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { requestWithdrawal } = require("../../src/services/account-service");
const { requestApproval, approveApprovalRequest } = require("../../src/services/admin-service");
const { handleCallback } = require("../../src/services/withdrawal-service");
const withdrawalService = require("../../src/services/withdrawal-service");
const huifu = require("../../src/services/withdrawal-provider/huifu-bafang");

test("production withdrawal approval authorizes provider submission without paying early", () => {
  const old = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  try {
    const state = createSeed(), user = state.users.find(item => item.id === "u_1001");
    user.withdrawableBalance = 100;
    const requested = requestWithdrawal(state, user, { amount: 10, openid: "wx-openid", recipientName: "收款人", idempotencyKey: "withdraw-test" });
    assert.equal(requested.ok, true);
    const approval = requestApproval(state, { action: "withdrawal.approve", targetType: "withdrawal", targetId: requested.withdrawal.id, reason: "复核" }, { role: { id: "finance" } }).approvalRequest;
    const beforeLedger = state.withdrawableLedger.length, beforeBalance = user.withdrawableBalance;
    const result = approveApprovalRequest(state, approval.id, { role: { id: "audit_ops" } }, "复核通过");
    assert.equal(result.ok, true);
    assert.equal(requested.withdrawal.status, "approved");
    assert.equal(requested.withdrawal.providerStatus, "APPROVED");
    assert.equal(state.withdrawableLedger.length, beforeLedger);
    assert.equal(user.withdrawableBalance, beforeBalance);
  } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});

test("withdrawal callback rejects unknown and reverse terminal states, while duplicate terminal is idempotent", () => {
  const state = createSeed(), user = state.users.find(item => item.id === "u_1001"); user.withdrawableBalance = 100;
  const requested = requestWithdrawal(state, user, { amount: 10, openid: "wx-openid", recipientName: "收款人", idempotencyKey: "callback-test" });
  const withdrawal = requested.withdrawal; withdrawal.status = "processing"; withdrawal.providerOrderId = "provider-1";
  const before = JSON.stringify(state);
  assert.equal(handleCallback(state, { order_id: "provider-1", status: "WAIT" }).status, 502);
  assert.equal(JSON.stringify(state), before);
  assert.equal(handleCallback(state, { order_id: "provider-1", status: "SUCCESS" }).ok, true);
  assert.equal(state.withdrawableLedger.filter(item => item.idempotencyKey === `${withdrawal.id}:payout`).length, 1);
  const afterSuccess = JSON.stringify(state);
  assert.equal(handleCallback(state, { order_id: "provider-1", status: "SUCCESS" }).idempotent, true);
  assert.equal(JSON.stringify(state), afterSuccess);
  assert.equal(handleCallback(state, { order_id: "provider-1", status: "FAILED" }).status, 409);
});

test("provider query shares callback state machine and does not reverse terminal withdrawals", async t => {
  const previous = { base: process.env.HF_BASE_URL, key: process.env.HF_COM_KEY, secret: process.env.HF_COM_SECRET };
  Object.assign(process.env, { HF_BASE_URL: "https://provider.invalid", HF_COM_KEY: "k", HF_COM_SECRET: "s" });
  t.after(() => { for (const [key, value] of Object.entries({ HF_BASE_URL: previous.base, HF_COM_KEY: previous.key, HF_COM_SECRET: previous.secret })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const state = createSeed(), user = state.users.find(item => item.id === "u_1001"); user.withdrawableBalance = 100;
  const requested = requestWithdrawal(state, user, { amount: 10, openid: "wx-openid", recipientName: "收款人" });
  requested.withdrawal.status = "processing"; requested.withdrawal.providerOrderId = "provider-q";
  t.mock.method(huifu, "isConfigured", () => true);
  let providerStatus = "SUCCESS";
  t.mock.method(huifu, "query", async () => ({ ok: true, body: { data: { status: providerStatus, order_id: "provider-q" } } }));
  assert.equal((await withdrawalService.queryWithdrawal(state, requested.withdrawal.id)).ok, true);
  assert.equal(requested.withdrawal.status, "success");
  const before = JSON.stringify(state);
  providerStatus = "FAILED";
  assert.equal((await withdrawalService.queryWithdrawal(state, requested.withdrawal.id)).status, 409);
  assert.equal(JSON.stringify(state), before);
});

test("provider success refuses conflicting existing payout evidence", () => {
  const state = createSeed(), user = state.users.find(item => item.id === "u_1001"); user.withdrawableBalance = 100;
  const requested = requestWithdrawal(state, user, { amount: 10, openid: "wx-openid", recipientName: "收款人" });
  const withdrawal = requested.withdrawal; withdrawal.status = "processing"; withdrawal.providerOrderId = "provider-conflict";
  state.withdrawableLedger.push({ id: "bad-payout", userId: user.id, changeType: "withdraw_payout", direction: "out", amount: 99, balanceAfter: user.withdrawableBalance, bizNo: withdrawal.id, idempotencyKey: `${withdrawal.id}:payout`, createdAt: new Date().toISOString() });
  const before = JSON.stringify(state);
  const result = handleCallback(state, { order_id: "provider-conflict", status: "SUCCESS" });
  assert.equal(result.status, 409); assert.equal(JSON.stringify(state), before);
});

test("provider success validates reported withdrawal amount and preserves state on mismatch", () => {
  const state = createSeed(), user = state.users.find(item => item.id === "u_1001"); user.withdrawableBalance = 100;
  const requested = requestWithdrawal(state, user, { amount: 10, openid: "wx-openid", recipientName: "收款人" });
  const withdrawal = requested.withdrawal; withdrawal.status = "processing"; withdrawal.providerOrderId = "provider-amount";
  assert.equal(handleCallback(state, { order_id: "provider-amount", status: "SUCCESS", amount: 10 }).ok, true);

  const stateCents = createSeed(), userCents = stateCents.users.find(item => item.id === "u_1001"); userCents.withdrawableBalance = 100;
  const reqCents = requestWithdrawal(stateCents, userCents, { amount: 10, openid: "wx-openid", recipientName: "收款人" });
  reqCents.withdrawal.status = "processing"; reqCents.withdrawal.providerOrderId = "provider-cents";
  assert.equal(handleCallback(stateCents, { order_id: "provider-cents", status: "SUCCESS", amount_cents: 1000 }).ok, true);

  const mismatch = createSeed(), mismatchUser = mismatch.users.find(item => item.id === "u_1001"); mismatchUser.withdrawableBalance = 100;
  const reqMismatch = requestWithdrawal(mismatch, mismatchUser, { amount: 10, openid: "wx-openid", recipientName: "收款人" });
  reqMismatch.withdrawal.status = "processing"; reqMismatch.withdrawal.providerOrderId = "provider-mismatch";
  const before = JSON.stringify(mismatch);
  assert.equal(handleCallback(mismatch, { order_id: "provider-mismatch", status: "SUCCESS", transfer_amount: 9 }).status, 409);
  assert.equal(JSON.stringify(mismatch), before);
});

test("provider success remains compatible when amount is omitted", () => {
  const state = createSeed(), user = state.users.find(item => item.id === "u_1001"); user.withdrawableBalance = 100;
  const requested = requestWithdrawal(state, user, { amount: 10, openid: "wx-openid", recipientName: "收款人" });
  requested.withdrawal.status = "processing"; requested.withdrawal.providerOrderId = "provider-no-amount";
  assert.equal(handleCallback(state, { order_id: "provider-no-amount", status: "SUCCESS" }).ok, true);
});
