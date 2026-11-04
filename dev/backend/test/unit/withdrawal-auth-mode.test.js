process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createSeed } = require("../../src/data/seed");
const account = require("../../src/services/account-service");
const withdrawalService = require("../../src/services/withdrawal-service");
const huifu = require("../../src/services/withdrawal-provider/huifu-bafang");

function setup(t, overrides = {}) {
  const env = {
    NODE_ENV: "production", TGG_STORE_DRIVER: "json", HF_TRANSFER_MODE: "",
    HF_MERCHANT_ID: "test-merchant", HF_WECHAT_APPID: "wx-test-app", ...overrides
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(huifu, "isConfigured", () => true);
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  user.withdrawableBalance = 100;
  user.wechatOpenid = "bound-openid";
  user.huifuAuthorization = {
    authorizationNo: "provider-issued-test-authorization", status: "active",
    merchantId: env.HF_MERCHANT_ID, appid: env.HF_WECHAT_APPID, openid: user.wechatOpenid,
    verifiedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  };
  return { state, user };
}

test("AUTH is the default and submitted legacy orders keep CONFIRM", () => {
  assert.equal(huifu.transferMode({}, {}), "AUTH");
  assert.equal(huifu.transferMode({ status: "approved" }, {}), "AUTH");
  assert.equal(huifu.transferMode({ status: "processing" }, { HF_TRANSFER_MODE: "AUTH" }), "CONFIRM");
  assert.equal(huifu.transferMode({ providerMerchantOrderId: "legacy" }, {}), "CONFIRM");
  assert.equal(huifu.transferMode({ transferMode: "AUTH", status: "processing" }, { HF_TRANSFER_MODE: "CONFIRM" }), "AUTH");
});

test("AUTH validates the server-owned authorization and all recipient bindings", t => {
  const { user } = setup(t);
  const original = structuredClone(user.huifuAuthorization);
  assert.equal(huifu.activeAuthorization(user).authorizationNo, original.authorizationNo);
  for (const mutation of [
    { status: "revoked" }, { authorizationNo: " " }, { merchantId: "another-merchant" },
    { appid: "another-app" }, { openid: "another-openid" }, { verifiedAt: "invalid" },
    { verifiedAt: new Date(Date.now() + 3600000).toISOString() },
    { expiresAt: new Date(Date.now() - 1000).toISOString() }, { expiresAt: "invalid" }
  ]) {
    user.huifuAuthorization = { ...original, ...mutation };
    assert.equal(huifu.activeAuthorization(user), null, JSON.stringify(mutation));
  }
});

test("unverified AUTH and forged client authorization cannot freeze production funds", t => {
  const { state, user } = setup(t);
  delete user.huifuAuthorization;
  const before = JSON.stringify(state);
  const result = account.requestWithdrawal(state, user, {
    amount: 10, idempotencyKey: "forged-auth", transferMode: "CONFIRM",
    authorizationNo: "forged", huifuAuthorization: { status: "active", authorizationNo: "forged" }
  });
  assert.equal(result.status, 409);
  assert.equal(JSON.stringify(state), before);
});

test("AUTH snapshots trusted authorization and retries remain idempotent after revocation", t => {
  const { state, user } = setup(t);
  const input = { amount: 10, idempotencyKey: "auth-create", authorizationNo: "client-forgery" };
  const result = account.requestWithdrawal(state, user, input);
  assert.equal(result.ok, true);
  assert.equal(result.withdrawal.transferMode, "AUTH");
  assert.equal(result.withdrawal.authorizationNo, user.huifuAuthorization.authorizationNo);
  assert.equal(user.withdrawableBalance, 90);
  const published = account.getWithdrawal(state, user.id, result.withdrawal.id);
  assert.equal(Object.hasOwn(published, "authorizationNo"), false);
  user.huifuAuthorization.status = "revoked";
  assert.equal(account.requestWithdrawal(state, user, input).idempotent, true);
  assert.equal(user.withdrawableBalance, 90);
  assert.equal(state.withdrawableLedger.filter(item => item.changeType === "withdraw_freeze").length, 1);
});

test("AUTH submits the verified number and keeps mode and provider key across config changes", async t => {
  const { state, user } = setup(t);
  const row = account.requestWithdrawal(state, user, { amount: 10 }).withdrawal;
  row.status = "approved";
  const payloads = [];
  t.mock.method(huifu, "submit", async payload => {
    payloads.push(payload);
    return { ok: true, body: { data: { platform_order_id: "auth-provider-order", transfer_state: "PROCESSING" } } };
  });
  assert.equal((await withdrawalService.submitWithdrawal(state, row.id)).ok, true);
  process.env.HF_TRANSFER_MODE = "CONFIRM";
  assert.equal((await withdrawalService.submitWithdrawal(state, row.id)).ok, true);
  assert.equal(payloads[0].transfer_mode, "AUTH");
  assert.equal(payloads[0].authorization_no, user.huifuAuthorization.authorizationNo);
  assert.equal(payloads[0].openid, user.wechatOpenid);
  assert.equal(payloads[0].transfer_amount, Math.round(row.arrivalAmount * 100));
  assert.equal(payloads[1].order_id, payloads[0].order_id);
  assert.equal(row.status, "processing");
  assert.equal(state.withdrawableLedger.some(item => item.changeType === "withdraw_payout"), false);
});

test("AUTH rejects revoked, replaced or mismatched authorization before provider submission", async t => {
  const { state, user } = setup(t);
  const row = account.requestWithdrawal(state, user, { amount: 10 }).withdrawal;
  row.status = "approved";
  const original = structuredClone(user.huifuAuthorization);
  const submit = t.mock.method(huifu, "submit", async () => { throw new Error("must not send"); });
  for (const mutation of [{ status: "revoked" }, { authorizationNo: "replacement" }, { openid: "another-user" }]) {
    user.huifuAuthorization = { ...original, ...mutation };
    const before = JSON.stringify(state);
    const result = await withdrawalService.submitWithdrawal(state, row.id);
    assert.equal(result.status, 409);
    assert.equal(JSON.stringify(state), before);
  }
  assert.equal(submit.mock.callCount(), 0);
});

test("legacy submitted CONFIRM order does not acquire AUTH requirements on retry", async t => {
  const { state, user } = setup(t);
  delete user.huifuAuthorization;
  const row = {
    id: "legacy-confirm-order", userId: user.id, status: "processing", openid: user.wechatOpenid,
    amount: 10, arrivalAmount: 10, providerMerchantOrderId: "legacy-provider-key"
  };
  state.withdrawRequests.push(row);
  let payload;
  t.mock.method(huifu, "submit", async input => {
    payload = input;
    return { ok: true, body: { data: { package_info: "legacy-package", transfer_state: "WAIT_USER_CONFIRM" } } };
  });
  assert.equal((await withdrawalService.submitWithdrawal(state, row.id)).ok, true);
  assert.equal(payload.transfer_mode, "CONFIRM");
  assert.equal(payload.order_id, "legacy-provider-key");
  assert.equal(row.transferMode, "CONFIRM");
  assert.equal(account.getWithdrawalTransferPackage(state, user.id, row.id).package, "legacy-package");
});

test("SQLite retains AUTH evidence and transfer snapshots across save and reload", t => {
  const { state, user } = setup(t);
  const row = account.requestWithdrawal(state, user, { amount: 10 }).withdrawal;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-auth-sqlite-"));
  const file = path.join(root, "auth.sqlite");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ["--no-warnings", "-e", `
    const { saveSQLiteState, loadSQLiteState } = require('./src/data/sqlite-store');
    const state = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    saveSQLiteState(state, process.argv[1]);
    process.stdout.write(JSON.stringify(loadSQLiteState(process.argv[1])));
  `, file], { cwd: path.resolve(__dirname, "../.."), input: JSON.stringify(state), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout);
  const saved = loaded.withdrawRequests.find(item => item.id === row.id);
  assert.equal(saved.transferMode, "AUTH");
  assert.equal(saved.authorizationNo, user.huifuAuthorization.authorizationNo);
  assert.deepEqual(loaded.users.find(item => item.id === user.id).huifuAuthorization, user.huifuAuthorization);
});
