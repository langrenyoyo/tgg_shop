process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const account = require("../../src/services/account-service");
const service = require("../../src/services/withdrawal-service");
const huifu = require("../../src/services/withdrawal-provider/huifu-bafang");
const { handleAccountRoutes } = require("../../src/routes/account-routes");

function setup(t) {
  const env = { HF_TRANSFER_MODE: "AUTH", HF_MERCHANT_ID: "1900000001", HF_WECHAT_APPID: "wx-test", HF_COM_KEY: "k".repeat(16), HF_COM_SECRET: "s".repeat(32), HF_CALLBACK_TOKEN: "t".repeat(32), HF_AUTHORIZATION_CALLBACK_TOKEN: "a".repeat(32) };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const state = createSeed(), user = state.users[0];
  user.wechatOpenid = "test-openid"; user.withdrawableBalance = 1000;
  user.huifuAuthorization = { authorizationNo: "HFA123456", status: "active", merchantId: env.HF_MERCHANT_ID, appid: env.HF_WECHAT_APPID, openid: user.wechatOpenid, verifiedAt: new Date().toISOString() };
  t.mock.method(huifu, "isConfigured", () => true);
  t.mock.method(huifu, "authorizationQuery", async () => ({ ok: true, body: { data: { merchant_id: env.HF_MERCHANT_ID, appid: env.HF_WECHAT_APPID, openid: user.wechatOpenid, authorization_no: "HFA123456", state: "TAKING_EFFECT" } } }));
  const row = account.requestWithdrawal(state, user, { amount: 10, idempotencyKey: "intent-1" }).withdrawal;
  row.status = "approved";
  const submit = t.mock.method(huifu, "submit", async data => {
    assert.equal(row.submission.orderId, data.order_id);
    assert.equal(row.submission.amountCents, data.transfer_amount);
    return { ok: true, body: { data: { order_id: data.order_id, platform_order_id: "platform-1", pay_status: 2 } } };
  });
  let response = {};
  const query = t.mock.method(huifu, "query", async () => ({ ok: true, body: { data: { order_id: row.providerMerchantOrderId, platform_order_id: "platform-1", pay_status: 3, ...response } } }));
  return { state, user, row, submit, query, env, set response(value) { response = value; } };
}

test("documented amount-less query settles only the persisted submitted amount, once", async t => {
  const f = setup(t);
  assert.equal((await service.submitWithdrawal(f.state, f.row.id)).ok, true);
  assert.equal((await service.queryWithdrawal(f.state, f.row.id)).ok, true);
  assert.equal(f.row.status, "success");
  assert.equal(f.user.withdrawableBalance, 990);
  assert.equal((await service.queryWithdrawal(f.state, f.row.id)).idempotent, true);
  const entries = f.state.withdrawableLedger.filter(x => x.bizNo === f.row.id);
  assert.equal(entries.filter(x => x.changeType === "withdraw_payout").length, 1);
  assert.equal(entries.find(x => x.changeType === "withdraw_payout").amount, 9.9);
  assert.equal(entries.filter(x => x.changeType === "withdraw_fee").length, 1);
});

test("query identity, returned amount and saved snapshot mismatches cannot settle", async t => {
  const f = setup(t);
  await service.submitWithdrawal(f.state, f.row.id);
  for (const bad of [{ order_id: "another" }, { platform_order_id: "another" }, { transfer_amount: 999 }, { pay_status: 2, error_code: "SUCCESS" }]) {
    f.response = bad;
    assert.equal((await service.queryWithdrawal(f.state, f.row.id)).ok, false);
    assert.equal(f.row.status, "processing");
  }
  f.response = {};
  f.row.submission.amountCents = 1000;
  assert.equal((await service.queryWithdrawal(f.state, f.row.id)).ok, false);
  delete f.row.submission;
  assert.equal((await service.queryWithdrawal(f.state, f.row.id)).ok, false);
  assert.equal(f.state.withdrawableLedger.some(x => x.changeType === "withdraw_payout"), false);
});

test("uncertain sends and concurrent submits preserve the original order and never send twice", async t => {
  const f = setup(t);
  let release;
  const send = t.mock.method(huifu, "submit", () => new Promise((resolve, reject) => { release = reject; }));
  const first = service.submitWithdrawal(f.state, f.row.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await service.submitWithdrawal(f.state, f.row.id)).status, 409);
  const key = f.row.providerMerchantOrderId;
  release(new Error("timeout"));
  assert.equal((await first).status, 502);
  assert.equal(f.row.status, "processing");
  assert.equal(f.user.withdrawableBalance, 990);
  assert.equal((await service.submitWithdrawal(f.state, f.row.id)).ok, true);
  assert.equal(f.row.status, "success");
  assert.equal(f.row.providerMerchantOrderId, key);
  assert.equal(send.mock.callCount(), 1);
});

test("encrypted V3 callback route reconciles by query and acknowledges with provider code", async t => {
  const f = setup(t);
  await service.submitWithdrawal(f.state, f.row.id);
  const data = { notify_type: "wx_transfer", order_id: f.row.providerMerchantOrderId, platform_order_id: "platform-1", pay_status: 3 };
  const envelope = { comKey: f.env.HF_COM_KEY, timestamp: Math.floor(Date.now() / 1000), data: huifu.encryptData(data, f.env.HF_COM_SECRET, f.env.HF_COM_KEY) };
  const ctx = { state: f.state, req: { method: "POST", headers: {} }, url: new URL("https://example.test/api/providers/huifu/withdraw-callback?token=" + f.env.HF_CALLBACK_TOKEN), readBody: async () => envelope, send: (res, status, body) => ({ status, body }) };
  assert.deepEqual(await handleAccountRoutes(ctx), { status: 200, body: { code: 200, message: "SUCCESS" } });
  assert.deepEqual(await handleAccountRoutes(ctx), { status: 200, body: { code: 200, message: "SUCCESS" } });
  assert.equal(f.state.withdrawableLedger.filter(x => x.changeType === "withdraw_payout").length, 1);
  ctx.readBody = async () => data;
  assert.equal((await handleAccountRoutes(ctx)).status, 400);
  ctx.readBody = async () => ({ ...envelope, comKey: "other-key" });
  assert.equal((await handleAccountRoutes(ctx)).status, 400);
});

test("authoritative failure unfreezes once and cannot reverse success", async t => {
  const f = setup(t);
  await service.submitWithdrawal(f.state, f.row.id);
  f.response = { pay_status: 4, error_code: "FAIL" };
  assert.equal((await service.queryWithdrawal(f.state, f.row.id)).ok, true);
  assert.equal((await service.queryWithdrawal(f.state, f.row.id)).ok, true);
  assert.equal(f.user.withdrawableBalance, 1000);
  assert.equal(f.state.withdrawableLedger.filter(x => x.changeType === "withdraw_unfreeze").length, 1);
  f.response = {};
  assert.equal((await service.queryWithdrawal(f.state, f.row.id)).status, 409);
});

test("V3 cap and authorization revocation block new money movements", async t => {
  const f = setup(t);
  const before = f.user.withdrawableBalance;
  assert.equal(account.requestWithdrawal(f.state, f.user, { amount: 200.01 }).ok, false);
  assert.equal(f.user.withdrawableBalance, before);
  t.mock.method(huifu, "authorizationQuery", async () => ({ ok: true, body: { data: { merchant_id: f.env.HF_MERCHANT_ID, appid: f.env.HF_WECHAT_APPID, openid: f.user.wechatOpenid, authorization_no: "HFA123456", state: "CLOSED" } } }));
  assert.equal((await service.submitWithdrawal(f.state, f.row.id)).status, 409);
  assert.equal(f.submit.mock.callCount(), 0);
  assert.equal(f.row.status, "approved");
});

test("authorization callback route accepts only encrypted bound V3 notifications and returns the official ACK", async t => {
  const f = setup(t);
  await require("../../src/services/huifu-authorization-service").statusForUser(f.state, f.user);
  const data = { notify_type: "wx_transfer_auth", authorization_no: "HFA123456", merchant_id: f.env.HF_MERCHANT_ID, appid: f.env.HF_WECHAT_APPID, openid: f.user.wechatOpenid, state: "TAKING_EFFECT" };
  const ctx = { state: f.state, req: { method: "POST", headers: {} }, url: new URL("https://example.test/api/providers/huifu/authorization-callback?token=" + f.env.HF_AUTHORIZATION_CALLBACK_TOKEN), readBody: async () => ({ comKey: f.env.HF_COM_KEY, timestamp: Math.floor(Date.now() / 1000), data: huifu.encryptData(data, f.env.HF_COM_SECRET, f.env.HF_COM_KEY) }), send: (res, status, body) => ({ status, body }) };
  assert.deepEqual(await handleAccountRoutes(ctx), { status: 200, body: { code: 200, message: "SUCCESS" } });
  data.openid = "other";
  assert.equal((await handleAccountRoutes(ctx)).status, 409);
  ctx.url.searchParams.set("token", f.env.HF_CALLBACK_TOKEN);
  assert.equal((await handleAccountRoutes(ctx)).status, 401);
});
