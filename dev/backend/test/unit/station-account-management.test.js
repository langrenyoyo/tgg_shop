process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resetState } = require("../../src/data/store");
const { normalizeState } = require("../../src/data/state-normalizer");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const accounts = require("../../src/services/station-account-service");
const auth = require("../../src/services/auth-service");
const station = require("../../src/services/station-service");
const { resolveStation } = require("../../src/domain/auth");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");
const { handleStationRoutes } = require("../../src/routes/station-routes");
const actor = { role: { id: "super_admin", permissions: ["*"] } };
const input = overrides => ({ username: "worker001", name: "收货员", password: "Worker-Password-1", siteIds: ["site_001"], permissions: ["station:receive"], reason: "开通站点人员", ...overrides });
const request = token => ({ headers: { authorization: `Bearer ${token}` } });

async function route(handler, state, method, url, token, body = {}) {
  let result;
  await handler({ state, req: { ...request(token), method }, url: new URL(url, "http://localhost"), readBody: async () => body,
    send: (_, status, data) => { result = { status, data }; } });
  return result;
}

test("admin creates independently authenticated station workers; hashes and grants survive reload", async () => {
  const state = resetState();
  const admin = auth.adminLogin(state, { username: "super_admin", password: "123456" });
  const created = await route(handleAdminRoutes, state, "POST", "/api/admin/station-accounts", admin.token, input());
  assert.equal(created.status, 201);
  const worker = state.stationAccounts.find(item => item.id === created.data.id);
  assert.match(worker.passwordHash, /^scrypt:/);
  assert.equal(auth.stationLogin(state, { username: worker.username, password: "123456" }).ok, false);
  const login = auth.stationLogin(state, { username: worker.username.toUpperCase(), password: input().password });
  assert.equal(login.ok, true);
  assert.deepEqual(login.station.permissions, ["station:receive"]);
  worker.wechatOpenid = "private-worker-openid";
  const list = await route(handleAdminRoutes, state, "GET", "/api/admin/station-accounts", admin.token);
  assert.equal(list.data.accounts.find(item => item.id === worker.id).wechatBound, true);
  assert.doesNotMatch(JSON.stringify([list.data, created.data, login.station, state.adminOperationLogs]), /scrypt:|private-worker-openid|Worker-Password-1/);
  saveSQLiteState(state, ":memory:");
  const restored = normalizeState(loadSQLiteState(":memory:"));
  const storedWorker = restored.stationAccounts.find(item => item.id === worker.id);
  assert.deepEqual(storedWorker, worker);
  assert.equal(auth.stationLogin(restored, { username: worker.username, password: input().password }).ok, true);
  assert.deepEqual(normalizeState({ ...restored, stationAccounts: [] }).stationAccounts, []);
});

test("invalid station accounts and unauthorized changes leave business state untouched", async () => {
  const state = resetState();
  const created = await accounts.mutate(state, null, "create", input(), actor);
  for (const invalid of [{ siteIds: [] }, { siteIds: ["missing"] }, { permissions: ["*"] }, { permissions: ["refund:approve"] }, { name: "" }, { reason: "" }, { status: "unknown" }, { username: "changed" }]) {
    const before = JSON.stringify(state);
    const result = await accounts.mutate(state, created.account.id, "update", { reason: "校验", ...invalid }, actor);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(state), before);
  }
  assert.equal((await accounts.mutate(state, null, "create", input({ username: "WORKER001" }), actor)).status, 409);
  assert.equal((await accounts.mutate(state, null, "create", input({ username: "worker002", password: "short" }), actor)).status, 400);
  const before = JSON.stringify(state);
  assert.equal((await accounts.mutate(state, created.account.id, "update", { status: "disabled", reason: "越权" }, { role: { permissions: ["pickup_site:write"] } })).status, 403);
  assert.equal(JSON.stringify(state), before);
});

test("station staff endpoints reject missing credentials and unrelated admin roles before reading bodies", async () => {
  const state = resetState();
  const low = auth.adminLogin(state, { username: "customer_service", password: "123456" });
  for (const [token, expected] of [["", 401], [low.token, 403]]) {
    for (const [method, path] of [["GET", ""], ["POST", ""], ["PATCH", "/station_001"], ["POST", "/station_001/reset-password"], ["POST", "/station_001/unbind-wechat"]]) {
      let status;
      await handleAdminRoutes({ state, req: { ...request(token), method }, url: new URL(`http://localhost/api/admin/station-accounts${path}`),
        readBody: () => { throw new Error("Unauthorized request body read"); }, send: (_, code) => { status = code; } });
      assert.equal(status, expected);
    }
  }
});

test("separate receive and pickup workers complete orders but cannot cross site or operation permissions", async () => {
  const state = resetState();
  const received = await accounts.mutate(state, null, "create", input(), actor);
  const picked = await accounts.mutate(state, null, "create", input({ username: "pickup001", permissions: ["station:pickup"] }), actor);
  const receiver = state.stationAccounts.find(item => item.id === received.account.id);
  const picker = state.stationAccounts.find(item => item.id === picked.account.id);
  const order = state.orders[0];
  const receiveLogin = auth.stationLogin(state, { username: receiver.username, password: input().password });
  const pickupLogin = auth.stationLogin(state, { username: picker.username, password: input().password });
  assert.equal((await route(handleStationRoutes, state, "POST", `/api/station/orders/${order.id}/receive`, pickupLogin.token)).status, 403);
  assert.equal((await route(handleStationRoutes, state, "POST", `/api/station/orders/${order.id}/exceptions`, receiveLogin.token, { remark: "no permission" })).status, 403);
  const before = JSON.stringify(order);
  assert.equal(station.receive(state, { ...receiver, siteIds: ["other"] }, order.id).status, 404);
  assert.equal(JSON.stringify(order), before);
  assert.equal(station.claim(state, receiver, order.id).ok, true);
  assert.equal((await route(handleStationRoutes, state, "POST", `/api/station/orders/${order.id}/receive`, receiveLogin.token, { idempotencyKey: "staff-receive" })).status, 200);
  assert.equal(station.pickup(state, receiver, order.id, { pickupCode: order.pickupCode }).status, 403);
  const complete = await route(handleStationRoutes, state, "POST", `/api/station/orders/${order.id}/pickup-verify`, pickupLogin.token, { pickupCode: order.pickupCode, idempotencyKey: "staff-pickup" });
  assert.equal(complete.status, 200);
  assert.equal(order.status, "completed");
});

test("staff changes revoke access and refresh sessions, release picking, and preserve explicit read-only grants", async () => {
  const state = resetState();
  const worker = state.stationAccounts[0];
  const login = auth.stationLogin(state, { username: worker.username, password: "123456" });
  assert.equal(station.claim(state, worker, state.orders[0].id).ok, true);
  assert.equal((await accounts.mutate(state, worker.id, "update", { permissions: [], reason: "调整为只读" }, actor)).ok, true);
  assert.equal(resolveStation(request(login.token), state).status, 401);
  assert.equal(auth.refresh(state, { refreshToken: login.refreshToken }, "station").status, 401);
  assert.equal(state.stationOrders[0].pickerId, "");
  assert.equal(state.orders[0].stationStatus, "expected");
  const next = auth.stationLogin(state, { username: worker.username, password: "123456" });
  assert.deepEqual(next.station.permissions, []);
  assert.equal(station.claim(state, worker, state.orders[0].id).status, 403);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))).stationAccounts[0].permissions, []);
  await accounts.mutate(state, worker.id, "update", { status: "disabled", reason: "离职" }, actor);
  assert.equal(resolveStation(request(next.token), state).status, 401);
  assert.equal(auth.stationLogin(state, { username: worker.username, password: "123456" }).status, 401);
  assert.equal(state.adminOperationLogs[1].detail.releasedOrders[0], state.orders[0].id);
});

test("password resets and WeChat unbinding invalidate old sessions without leaking or restoring credentials", async t => {
  const state = resetState(), worker = state.stationAccounts[0];
  const old = auth.stationLogin(state, { username: worker.username, password: "123456" });
  worker.wechatOpenid = "bound-worker";
  await accounts.mutate(state, worker.id, "reset-password", { password: "New-password-88", reason: "换密码" }, actor);
  assert.equal(resolveStation(request(old.token), state).status, 401);
  assert.equal(auth.stationLogin(state, { username: worker.username, password: "123456" }).ok, false);
  assert.equal(auth.stationLogin(state, { username: worker.username, password: "New-password-88" }).ok, true);
  assert.equal(worker.wechatOpenid, "bound-worker");
  t.mock.method(global, "fetch", async () => ({ json: async () => ({ openid: "bound-worker" }) }));
  const env = { WECHAT_APPID: process.env.WECHAT_APPID, WECHAT_APPSECRET: process.env.WECHAT_APPSECRET };
  process.env.WECHAT_APPID = "test-app"; process.env.WECHAT_APPSECRET = "test-secret";
  t.after(() => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const wechat = await auth.stationWechatLogin(state, { code: "code" });
  assert.equal(wechat.ok, true);
  await accounts.mutate(state, worker.id, "unbind-wechat", { reason: "更换微信" }, actor);
  assert.equal(worker.wechatOpenid, "");
  assert.equal(resolveStation(request(wechat.token), state).status, 401);
  assert.equal((await auth.stationWechatLogin(state, { code: "code" })).status, 403);
  let finish;
  global.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = auth.bindStationWechat(state, worker, { code: "late-code" });
  await accounts.mutate(state, worker.id, "unbind-wechat", { reason: "取消绑定" }, actor);
  finish({ json: async () => ({ openid: "bound-worker" }) });
  assert.equal((await pending).status, 401);
  assert.equal(worker.wechatOpenid, "");
  assert.doesNotMatch(JSON.stringify(state.adminOperationLogs), /New-password-88|bound-worker|scrypt:/);
});
