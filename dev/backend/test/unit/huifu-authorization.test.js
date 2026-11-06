process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const huifu = require("../../src/services/withdrawal-provider/huifu-bafang");
const authorization = require("../../src/services/huifu-authorization-service");

function setup(t) {
  const env = { HF_TRANSFER_MODE: "AUTH", HF_MERCHANT_ID: "1900000001", HF_WECHAT_APPID: "wx-test-app", HF_WECHAT_MCH_ID: "1900000001", HF_AUTHORIZATION_PATH: "/wx/auth/apply" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const state = createSeed(), user = state.users[0];
  user.wechatOpenid = "openid-test";
  let remote = null, queryError = null, payload;
  const query = t.mock.method(huifu, "authorizationQuery", async input => {
    assert.deepEqual(input, { merchant_id: env.HF_MERCHANT_ID, appid: env.HF_WECHAT_APPID, openid: user.wechatOpenid });
    if (queryError) throw queryError;
    return remote ? { ok: true, body: { data: remote } } : { ok: false, httpStatus: 200, body: { code: 1002 } };
  });
  const apply = t.mock.method(huifu, "authorizationStart", async input => {
    payload = input;
    assert.equal(state.huifuAuthorizationSessions[0].authorizationNo, input.authorization_no);
    remote = { ...input, state: "WAIT_USER_CONFIRM", package_info: "native-package", wx_create_time: new Date().toISOString() };
    return { ok: true, body: { data: { authorization_no: input.authorization_no, state: remote.state, package_info: remote.package_info, wx_create_time: remote.wx_create_time } } };
  });
  return { state, user, apply, query, get remote() { return remote; }, set remote(value) { remote = value; }, get payload() { return payload; }, set queryError(value) { queryError = value; } };
}

test("V3 creates a merchant-generated authorization number with required fields and reuses pending packages", async t => {
  const f = setup(t);
  const result = await authorization.start(f.state, f.user);
  assert.equal(result.ok, true);
  assert.equal(result.status, "pending");
  assert.equal(result.authorizationPackage, "native-package");
  assert.equal(result.mchId, "1900000001");
  assert.match(f.payload.authorization_no, /^[a-zA-Z0-9]{5,32}$/);
  assert.ok(f.payload.user_display_name);
  assert.equal(f.payload.user_recv_perception, "现金奖励");
  assert.equal(f.payload.state, undefined);
  assert.equal(f.payload.nonce, undefined);
  assert.equal(huifu.activeAuthorization(f.user), null);
  assert.ok(Date.parse(result.expiresAt) - Date.now() > 86300000);
  assert.equal((await authorization.start(f.state, f.user)).authorizationPackage, result.authorizationPackage);
  assert.equal(f.apply.mock.callCount(), 1);
});

test("only TAKING_EFFECT with matching server identity activates AUTH; CLOSED cannot be replayed active", async t => {
  const f = setup(t);
  await authorization.start(f.state, f.user);
  const original = { ...f.remote };
  f.remote = { ...original, state: "TAKING_EFFECT", openid: "other" };
  assert.equal((await authorization.statusForUser(f.state, f.user)).status, 409);
  assert.equal(huifu.activeAuthorization(f.user), null);
  f.remote = { ...original, state: "TAKING_EFFECT" };
  assert.equal((await authorization.statusForUser(f.state, f.user)).status, "active");
  assert.equal(f.user.huifuAuthorization.expiresAt, undefined);
  f.remote = { ...original, state: "WAIT_USER_CONFIRM" };
  assert.equal((await authorization.statusForUser(f.state, f.user)).ok, false);
  f.remote = { ...f.remote, state: "CLOSED", close_reason: "USER_CLOSE" };
  const callback = { ...original, notify_type: "wx_transfer_auth", state: "TAKING_EFFECT" };
  assert.equal((await authorization.handleCallback(f.state, callback)).ok, true);
  assert.equal(f.user.huifuAuthorization.status, "revoked");
  f.remote = { ...original, state: "TAKING_EFFECT" };
  assert.equal((await authorization.statusForUser(f.state, f.user)).ok, false);
  assert.equal(huifu.activeAuthorization(f.user), null);
});

test("callback validates authorization number, notification type and all identity fields before querying", async t => {
  const f = setup(t);
  await authorization.start(f.state, f.user);
  const data = { ...f.remote, notify_type: "wx_transfer_auth" };
  const calls = f.query.mock.callCount();
  for (const patch of [{ authorization_no: "unknown" }, { openid: "other" }, { appid: "" }, { merchant_id: "" }, { notify_type: "wx_transfer" }, { state: "ACTIVE" }]) {
    assert.equal((await authorization.handleCallback(f.state, { ...data, ...patch })).ok, false);
  }
  assert.equal(f.query.mock.callCount(), calls);
});

test("network and business query failures do not become missing consent or trigger new applies", async t => {
  const f = setup(t);
  f.queryError = new Error("timeout");
  assert.equal((await authorization.start(f.state, f.user)).status, 502);
  assert.equal(f.apply.mock.callCount(), 0);
  f.queryError = null;
  t.mock.method(huifu, "authorizationQuery", async () => ({ ok: false, httpStatus: 200, body: { code: 1001 } }));
  assert.equal((await authorization.statusForUser(f.state, f.user)).status, 502);
  assert.equal((await authorization.start(f.state, f.user)).status, 502);
  assert.equal(f.apply.mock.callCount(), 0);
});

test("expired pending authorization must be confirmed closed before generating another number", async t => {
  const f = setup(t);
  await authorization.start(f.state, f.user);
  const original = f.remote.authorization_no;
  f.remote.wx_create_time = new Date(Date.now() - 86500000).toISOString();
  assert.equal((await authorization.start(f.state, f.user)).ok, false);
  assert.equal(f.apply.mock.callCount(), 1);
  f.remote = { ...f.remote, state: "CLOSED", close_reason: "USER_OVERDUE_UNCONFIRMED" };
  assert.equal((await authorization.statusForUser(f.state, f.user)).status, "expired");
  assert.equal((await authorization.start(f.state, f.user)).ok, true);
  assert.notEqual(f.remote.authorization_no, original);
});

test("uncertain authorization apply retries keep the saved number and simultaneous attempts are blocked", async t => {
  const f = setup(t);
  let release;
  t.mock.method(huifu, "authorizationStart", () => new Promise(resolve => { release = resolve; }));
  const pending = authorization.start(f.state, f.user);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await authorization.start(f.state, f.user)).status, 409);
  const number = f.state.huifuAuthorizationSessions[0].authorizationNo;
  release({ ok: false, httpStatus: 504 });
  await pending;
  let retryNumber;
  t.mock.method(huifu, "authorizationStart", async data => { retryNumber = data.authorization_no; throw new Error("timeout"); });
  assert.equal((await authorization.start(f.state, f.user)).status, 502);
  assert.equal(retryNumber, number);
});
