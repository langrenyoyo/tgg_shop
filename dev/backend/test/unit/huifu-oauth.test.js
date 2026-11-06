process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const hf = require("../../src/services/withdrawal-provider/huifu-bafang");
const auth = require("../../src/services/huifu-authorization-service");
const account = require("../../src/services/account-service");
const withdrawals = require("../../src/services/withdrawal-service");

function setup(t, authPath = "/api/getOauthConfig") {
  const env = { HF_TRANSFER_MODE: "OAUTH", HF_AUTHORIZATION_PATH: authPath, HF_BASE_URL: "https://example.test",
    HF_MERCHANT_ID: "merchant-bound", HF_WECHAT_APPID: "wx1234567890abcdef", HF_COM_KEY: "k".repeat(16), HF_COM_SECRET: "s".repeat(32), NODE_ENV: "production" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const state = createSeed(), user = state.users[0];
  user.wechatOpenid = "real-server-bound-openid"; user.withdrawableBalance = 1000;
  let provider = { is_auth: 0, hf_appid: "wxabcdef1234567890", path: "/pages/oauth/index", query: "appid=wx1234567890abcdef&data=a%2Bb%3D" };
  const oauth = t.mock.method(hf, "oauthConfig", async input => {
    assert.deepEqual(input, { account: hf.oauthAccount(user), merchant_id: env.HF_MERCHANT_ID, appid: env.HF_WECHAT_APPID });
    return { ok: true, body: { code: 200, data: provider } };
  });
  const v3query = t.mock.method(hf, "authorizationQuery", () => { throw new Error("must not call V3 auth query"); });
  const v3apply = t.mock.method(hf, "authorizationStart", () => { throw new Error("must not apply V3 consent"); });
  const v3send = t.mock.method(hf, "submit", () => { throw new Error("must not use V3 transfer"); });
  const submit = t.mock.method(hf, "batchSubmit", async input => {
    const w = state.withdrawRequests[0];
    assert.equal(w.submission.account, input.details[0].openid);
    assert.equal(w.submission.batchNo, input.batch_no);
    assert.equal(w.submission.orderId, input.details[0].order_id);
    assert.equal(input.total_amount, input.details[0].transfer_amount);
    assert.equal(input.total_num, 1);
    assert.equal(input.details[0].openid, hf.oauthAccount(user));
    assert.equal(input.authorization_no, undefined);
    assert.equal(input.transfer_mode, undefined);
    return { ok: true, body: { data: { batch_no: input.batch_no, out_batch_no: "provider-batch", month: w.submission.month } } };
  });
  let detailPatch = {}, batchPatch = {}, detailStatus = 3;
  const batchQuery = t.mock.method(hf, "batchQuery", async input => {
    const s = state.withdrawRequests[0].submission;
    assert.equal(input.batch_no, s.batchNo); assert.equal(input.month, s.month);
    return { ok: true, body: { data: { transfer_batch: { batch_no: s.batchNo, total_num: 1, total_amount: s.amountCents, batch_status: "FINISHED", ...batchPatch },
      transfer_detail_list: [{ order_id: s.orderId, pay_status: detailStatus }] } } };
  });
  const detailQuery = t.mock.method(hf, "batchDetailQuery", async input => {
    const s = state.withdrawRequests[0].submission;
    assert.deepEqual(input, { batch_no: s.batchNo, month: s.month, order_id: s.orderId });
    return { ok: true, body: { data: { order_id: s.orderId, batch_no: s.batchNo, pay_status: detailStatus, ...detailPatch } } };
  });
  async function approved(amount = 10) {
    provider = { is_auth: 1 };
    await auth.statusForUser(state, user);
    const result = account.requestWithdrawal(state, user, { amount, idempotencyKey: "intent-1" });
    assert.equal(result.ok, true);
    result.withdrawal.status = "approved";
    return result.withdrawal;
  }
  return { state, user, env, oauth, v3query, v3apply, v3send, submit, batchQuery, detailQuery, approved,
    set provider(value) { provider = value; }, set detailPatch(value) { detailPatch = value; }, set batchPatch(value) { batchPatch = value; }, set detailStatus(value) { detailStatus = value; } };
}

test("4.13 binds a server account, preserves encoded query and never manufactures V3 authorization", async t => {
  const f = setup(t);
  const status = await auth.statusForUser(f.state, f.user);
  assert.equal(status.status, "none"); assert.equal(status.method, "miniProgram"); assert.equal(status.path, undefined);
  const started = await auth.start(f.state, f.user, { account: "attacker", is_auth: 1 });
  assert.equal(started.appId, "wxabcdef1234567890");
  assert.equal(started.path, "pages/oauth/index?appid=wx1234567890abcdef&data=a%2Bb%3D");
  assert.equal(started.authorizationPackage, undefined);
  assert.equal(hf.activeAuthorization(f.user), null);
  f.provider = { is_auth: 1 };
  assert.equal((await auth.statusForUser(f.state, f.user)).status, "active");
  assert.equal(hf.activeAuthorization(f.user).account, hf.oauthAccount(f.user));
  assert.equal(hf.activeAuthorization(f.user, { ...f.env, HF_TRANSFER_MODE: "AUTH" }), null);
  assert.equal(f.v3query.mock.callCount() + f.v3apply.mock.callCount(), 0);
  f.user.wechatOpenid = "changed";
  assert.equal(hf.activeAuthorization(f.user), null);
});

test("unbound identities, malformed configuration and unknown states cannot authorize or freeze money", async t => {
  const f = setup(t);
  const before = f.user.withdrawableBalance;
  for (const provider of [{}, { is_auth: true }, { is_auth: 2 }, { is_auth: 0, hf_appid: "bad", path: "https://bad", query: "secret" }]) {
    f.provider = provider;
    assert.equal((await auth.start(f.state, f.user)).ok, false);
    assert.equal(account.requestWithdrawal(f.state, f.user, { amount: 1 }).ok, false);
  }
  assert.equal(f.user.withdrawableBalance, before);
  f.provider = { is_auth: 1 };
  await auth.statusForUser(f.state, f.user);
  f.provider = { is_auth: 0 };
  assert.equal((await auth.start(f.state, f.user)).ok, false);
  assert.equal(hf.activeAuthorization(f.user), null);
  f.user.wechatOpenid = "";
  const count = f.oauth.mock.callCount();
  assert.equal((await auth.start(f.state, f.user)).status, 503);
  assert.equal(f.oauth.mock.callCount(), count);
});

test("provider errors remain actionable failures and cannot initiate payment", async t => {
  const f = setup(t), w = await f.approved();
  f.oauth.mock.mockImplementation(async () => ({ ok: false, httpStatus: 200, body: { code: 1001, message: "商户号没有开通该接口权限" } }));
  assert.equal((await auth.start(f.state, f.user)).status, 503);
  assert.equal((await withdrawals.submitWithdrawal(f.state, w.id)).ok, false);
  assert.equal(f.submit.mock.callCount(), 0);
  f.oauth.mock.mockImplementation(async () => { throw new Error("timeout"); });
  assert.equal((await auth.statusForUser(f.state, f.user)).status, 502);
});

test("4.3 acceptance stays processing; batch plus detail queries settle the original account exactly once", async t => {
  const f = setup(t), w = await f.approved(500);
  assert.equal((await withdrawals.submitWithdrawal(f.state, w.id)).ok, true);
  assert.equal(w.status, "processing"); assert.equal(f.v3send.mock.callCount(), 0);
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, true);
  assert.equal(w.status, "success"); assert.equal(f.user.withdrawableBalance, 500);
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).idempotent, true);
  assert.equal(f.state.withdrawableLedger.filter(x => x.changeType === "withdraw_payout").length, 1);
  assert.equal(account.requestWithdrawal(f.state, f.user, { amount: 1 }).ok, false); // daily 500 cap
});

test("uncertain 4.3 send never resubmits; persisted protocol survives a global mode change", async t => {
  const f = setup(t), w = await f.approved();
  const submit = f.submit;
  submit.mock.mockImplementation(async () => { throw new Error("timeout"); });
  assert.equal((await withdrawals.submitWithdrawal(f.state, w.id)).status, 502);
  const snapshot = structuredClone(w.submission);
  process.env.HF_TRANSFER_MODE = "AUTH";
  assert.equal((await withdrawals.submitWithdrawal(f.state, w.id)).ok, true);
  assert.deepEqual(w.submission, snapshot);
  assert.equal(submit.mock.callCount(), 1);
  assert.equal(w.status, "success");
});

test("wrong batch/detail, amount mismatch and conflicting status cannot settle or unfreeze", async t => {
  const f = setup(t), w = await f.approved();
  await withdrawals.submitWithdrawal(f.state, w.id);
  for (const bad of [{ batch_no: "other" }, { order_id: "other" }, { pay_status: 4 }, { pay_status: 99 }, { tax_info: { vat_amount: 1, iit_amount: 1, received_price: 1 } }]) {
    f.detailPatch = bad;
    assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, false);
    assert.equal(w.status, "processing");
  }
  f.detailPatch = {}; f.batchPatch = { total_amount: 999 };
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, false);
  f.batchPatch = {}; w.submission.account = "different-account";
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, false);
  assert.equal(f.user.withdrawableBalance, 990);
});

test("FINISHED batch with failed detail refunds once; abnormal or processing detail keeps funds frozen", async t => {
  const f = setup(t), w = await f.approved();
  await withdrawals.submitWithdrawal(f.state, w.id);
  for (const status of [-1, 1, 2]) {
    f.detailStatus = status;
    assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, true);
    assert.equal(w.status, "processing"); assert.equal(f.user.withdrawableBalance, 990);
  }
  f.detailStatus = 4;
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, true);
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).idempotent, true);
  assert.equal(f.user.withdrawableBalance, 1000);
  assert.equal(f.state.withdrawableLedger.filter(x => x.changeType === "withdraw_unfreeze").length, 1);
  f.detailStatus = 3;
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).status, 409);
});

test("4.5 documented withholding is retained separately and only public amounts are exposed", async t => {
  const f = setup(t), w = await f.approved();
  await withdrawals.submitWithdrawal(f.state, w.id);
  f.detailPatch = { tax_info: { vat_amount: 10, iit_amount: 20, received_price: 960 } };
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, true);
  const publicRow = account.publicWithdrawal(w);
  assert.equal(publicRow.actualArrivalAmount, 9.6);
  assert.equal(publicRow.withheldTaxAmount, 0.3);
  assert.equal(publicRow.submission, undefined);
  assert.equal(publicRow.account, undefined);
});

test("4.13 and 4.3 adapters encrypt the documented payload and keep credentials out of logs", async t => {
  const env = { HF_BASE_URL: "https://example.test", HF_COM_KEY: "k".repeat(16), HF_COM_SECRET: "s".repeat(32), HF_MERCHANT_ID: "merchant", HF_WECHAT_APPID: "wx123", HF_AUTHORIZATION_PATH: "/api/getOauthConfig" };
  const log = t.mock.method(console, "info", () => {});
  const calls = [];
  const fetch = async (url, options) => {
    const envelope = JSON.parse(options.body);
    calls.push({ url, data: hf.decryptData(envelope.data, env.HF_COM_SECRET, env.HF_COM_KEY) });
    assert.equal(Number.isInteger(envelope.timestamp), true);
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { is_auth: 0, query: "sensitive-query" } }) };
  };
  const payload = { account: "server-account", merchant_id: "merchant", appid: "wx123" };
  await hf.oauthConfig(payload, env, fetch);
  await hf.batchSubmit({ batch_no: "B12345" }, env, fetch);
  await hf.batchQuery({ batch_no: "B12345" }, env, fetch);
  await hf.batchDetailQuery({ order_id: "D12345" }, env, fetch);
  assert.deepEqual(calls.map(x => x.url), ["/api/getOauthConfig", "/api/wx/wxorderBatchPay", "/api/wx/wxBatchQuery", "/api/wx/wxBatchDetailQuery"].map(x => env.HF_BASE_URL + x));
  assert.deepEqual(calls[0].data, payload);
  assert.doesNotMatch(JSON.stringify(log.mock.calls), /server-account|sensitive-query|kkkkkkkk|ssssssss/);
});

test("SQLite reload retains the 4.13 account and 4.3 batch/month submission evidence", async t => {
  const f = setup(t), w = await f.approved();
  await withdrawals.submitWithdrawal(f.state, w.id);
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-oauth-sqlite-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = require("node:child_process").spawnSync(process.execPath, ["--no-warnings", "-e", `
    const { saveSQLiteState, loadSQLiteState } = require('./src/data/sqlite-store');
    const state = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    saveSQLiteState(state, process.argv[1]);
    process.stdout.write(JSON.stringify(loadSQLiteState(process.argv[1])));
  `, path.join(root, "oauth.sqlite")], { cwd: path.resolve(__dirname, "../.."), input: JSON.stringify(f.state), encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
  assert.equal(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout), row = loaded.withdrawRequests.find(item => item.id === w.id);
  assert.equal(row.transferMode, "OAUTH");
  assert.deepEqual(row.submission, w.submission);
  assert.deepEqual(loaded.users.find(item => item.id === f.user.id).huifuAuthorization, f.user.huifuAuthorization);
  process.env.HF_TRANSFER_MODE = "AUTH";
  assert.equal((await withdrawals.queryWithdrawal(loaded, row.id)).ok, true);
  assert.equal(row.status, "success");
});

test("provider OAUTH_FAIL clears local consent after a matched failed detail", async t => {
  const f = setup(t), w = await f.approved();
  await withdrawals.submitWithdrawal(f.state, w.id);
  f.detailStatus = 4; f.detailPatch = { error_code: "OAUTH_FAIL" };
  assert.equal((await withdrawals.queryWithdrawal(f.state, w.id)).ok, true);
  assert.equal(hf.activeAuthorization(f.user), null);
  assert.equal(f.user.withdrawableBalance, 1000);
});

test("switching to 4.13 does not send or query historical V3 orders as Chapter 4 batches", async t => {
  const f = setup(t);
  const row = { id: "old-v3", userId: f.user.id, status: "processing", transferMode: "AUTH", openid: f.user.wechatOpenid,
    amount: 10, arrivalAmount: 10, providerMerchantOrderId: "V3ORDER", providerOrderId: "V3PLATFORM",
    authorizationNo: "V3AUTH", submittedAt: new Date().toISOString(),
    submission: { orderId: "V3ORDER", merchantId: f.env.HF_MERCHANT_ID, appid: f.env.HF_WECHAT_APPID,
      openid: f.user.wechatOpenid, amountCents: 1000, transferMode: "AUTH", authorizationNo: "V3AUTH" } };
  f.state.withdrawRequests.unshift(row);
  const query = t.mock.method(hf, "query", async input => {
    assert.deepEqual(input, { platform_order_id: "V3PLATFORM" });
    return { ok: true, body: { data: { order_id: "V3ORDER", platform_order_id: "V3PLATFORM", pay_status: 3 } } };
  });
  assert.equal((await withdrawals.queryWithdrawal(f.state, row.id)).ok, true);
  assert.equal(row.status, "success"); assert.equal(query.mock.callCount(), 1);
  assert.equal(f.batchQuery.mock.callCount() + f.detailQuery.mock.callCount() + f.submit.mock.callCount(), 0);
});

test("4.14 returns a validated scheme and keeps the same server account for Chapter 4 payout", async t => {
  const f = setup(t, "/api/mp/getScheme");
  const scheme = "weixin://dl/business/?t=ticket%2B123%3D";
  const expireTime = Math.floor(Date.now() / 1000) + 300;
  f.provider = { is_auth: 0, scheme, expire_time: expireTime };
  const result = await auth.start(f.state, f.user, { account: "forged", is_auth: 1 });
  assert.equal(result.method, "urlScheme");
  assert.equal(result.status, "none");
  assert.equal(result.scheme, scheme);
  assert.equal(result.expireTime, expireTime);
  assert.equal(result.appId, undefined);
  assert.equal(result.path, undefined);
  const status = await auth.statusForUser(f.state, f.user);
  assert.equal(status.scheme, undefined);
  assert.equal(status.status, "none");
  f.provider = { is_auth: 2 }; // 4.14 documents ANY positive integer as authorized.
  assert.equal((await auth.statusForUser(f.state, f.user)).status, "active");
  const savedAccount = hf.activeAuthorization(f.user).account;
  process.env.HF_AUTHORIZATION_PATH = "/api/getOauthConfig";
  f.provider = { is_auth: 1 };
  await auth.statusForUser(f.state, f.user);
  assert.equal(hf.activeAuthorization(f.user).account, savedAccount);
});

test("4.14 rejects expired or malformed links and invalid consent while allowing permanent links", async t => {
  const f = setup(t, "/api/mp/getScheme");
  const scheme = "weixin://dl/business/?t=ticket123";
  for (const value of [0, 1, Math.floor(Date.now() / 1000) - 1]) {
    f.provider = { is_auth: 0, scheme, expire_time: value };
    assert.equal((await auth.start(f.state, f.user)).status, 409);
  }
  for (const value of [null, true, "", undefined, -2, 1.5, 9999999999999999]) {
    f.provider = { is_auth: 0, scheme, expire_time: value };
    assert.equal((await auth.start(f.state, f.user)).status, 502);
  }
  for (const value of ["https://evil.test", "javascript:alert(1)", "weixin://dl/business/?t=abc#evil", "weixin://other/?t=abc", ""]) {
    f.provider = { is_auth: 0, scheme: value, expire_time: -1 };
    assert.equal((await auth.start(f.state, f.user)).ok, false);
  }
  for (const value of [true, false, null, -1, 1.1, "", {}, "1e2"]) {
    f.provider = { is_auth: value, scheme, expire_time: -1 };
    assert.equal((await auth.statusForUser(f.state, f.user)).ok, false);
  }
  f.provider = { is_auth: 1 };
  await auth.statusForUser(f.state, f.user);
  f.provider = { is_auth: 0, scheme, expire_time: 0 };
  await auth.start(f.state, f.user);
  assert.equal(hf.activeAuthorization(f.user), null);
  f.provider = { is_auth: "0", scheme, expire_time: "-1" };
  assert.equal((await auth.start(f.state, f.user)).expireTime, -1);
});

test("OAUTH's new default adapter calls 4.14 with encrypted account and bound platform appid", async t => {
  const env = { HF_BASE_URL: "https://example.test", HF_COM_KEY: "k".repeat(16), HF_COM_SECRET: "s".repeat(32), HF_MERCHANT_ID: "merchant", HF_WECHAT_APPID: "platform-app" };
  const payload = { account: "stable-account", merchant_id: "merchant", appid: "platform-app" };
  t.mock.method(console, "info", () => {});
  const result = await hf.oauthConfig(payload, env, async (url, options) => {
    assert.equal(url, "https://example.test/api/mp/getScheme");
    assert.deepEqual(hf.decryptData(JSON.parse(options.body).data, env.HF_COM_SECRET, env.HF_COM_KEY), payload);
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { is_auth: 0, scheme: "weixin://dl/business/?t=ticket", expire_time: -1 } }) };
  });
  assert.equal(result.ok, true);
});
