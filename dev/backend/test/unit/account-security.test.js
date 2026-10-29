process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { publicUser } = require("../../src/http/http-utils");
const { requestWithdrawal, publicWithdrawal } = require("../../src/services/account-service");
const huifu = require("../../src/services/withdrawal-provider/huifu-bafang");

test("public user payload excludes credentials, provider identifiers, and auth metadata", () => {
  const result = publicUser({
    id: "u-test",
    nickname: "Test",
    phone: "13800000000",
    role: "normal",
    memberUntil: null,
    points: 1,
    withdrawableBalance: 2,
    inviteCode: "INVITE",
    signinStreak: 0,
    status: "active",
    avatarUrl: "",
    passwordHash: "secret",
    wechatOpenid: "openid-private",
    openid: "openid-private",
    authVersion: 3
  });

  assert.equal(result.id, "u-test");
  for (const key of ["passwordHash", "wechatOpenid", "openid", "authVersion"]) {
    assert.equal(Object.hasOwn(result, key), false, key);
  }
});

test("public withdrawal payload excludes recipient identity and provider internals", () => {
  const result = publicWithdrawal({
    id: "wd-1", userId: "u-1", amount: 10, fee: 0.1, arrivalAmount: 9.9, channel: "wechat",
    status: "processing", recipientName: "收款人", openid: "openid-private",
    providerOrderId: "provider-order", providerMerchantOrderId: "merchant-order",
    providerErrorMessage: "private provider message", transferPackage: { secret: "private" }, reason: "请核对收款信息",
    createdAt: "2026-10-17T00:00:00.000Z"
  });

  assert.deepEqual(result, {
    id: "wd-1", amount: 10, fee: 0.1, arrivalAmount: 9.9, channel: "wechat",
    status: "processing", recipientName: "收款人", reason: "请核对收款信息", createdAt: "2026-10-17T00:00:00.000Z"
  });
  for (const key of ["userId", "openid", "providerOrderId", "providerMerchantOrderId", "providerErrorMessage", "transferPackage"]) {
    assert.equal(Object.hasOwn(result, key), false, key);
  }
});

test("production withdrawal cannot redirect funds to a client-supplied openid", t => {
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.mock.method(huifu, "isConfigured", () => true);
  t.after(() => {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  });

  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  user.wechatOpenid = "bound-openid";
  user.withdrawableBalance = 100;
  const before = JSON.stringify(state);
  const result = requestWithdrawal(state, user, {
    amount: 10,
    openid: "attacker-openid",
    recipientName: "收款人",
    idempotencyKey: "forged-openid"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(state.withdrawRequests.length, 0);
  assert.equal(JSON.stringify(state), before);
});

test("production withdrawal requires a server-bound wechat identity", t => {
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.mock.method(huifu, "isConfigured", () => true);
  t.after(() => {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  });

  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  delete user.wechatOpenid;
  delete user.openid;
  user.withdrawableBalance = 100;
  const result = requestWithdrawal(state, user, {
    amount: 10,
    openid: "client-only-openid",
    recipientName: "收款人",
    idempotencyKey: "unbound-openid"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(state.withdrawRequests.length, 0);
  assert.equal(user.withdrawableBalance, 100);
});
