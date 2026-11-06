const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const storage = new Map();
  const calls = [];
  const app = { globalData: {} };
  const context = { module: { exports: {} }, require: () => ({ develop: "https://shop.taoguoguo.cc" }), getApp: () => app, wx: {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => calls.push(options),
    uploadFile: options => calls.push(options),
    base64ToArrayBuffer: value => Uint8Array.from(Buffer.from(value, "base64")).buffer
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/api.js"), "utf8"), context);
  const api = context.module.exports;
  api.saveSession({ token: "alice-old", refreshToken: "alice-refresh", user: { id: "alice" } });
  return { api, storage, calls };
}
const tick = () => new Promise(setImmediate);
const reply = (call, statusCode, data) => call.success({ statusCode, data });

test("late account response and upload cannot cross a login boundary", async () => {
  const { api, calls, storage } = setup();
  const profile = assert.rejects(api.request("/api/me"), /账号已变更/);
  const upload = assert.rejects(api.uploadFile("picture.png"), /账号已变更/);
  api.saveSession({ token: "bob", user: { id: "bob" } });
  reply(calls[0], 200, { id: "alice" });
  reply(calls[1], 200, JSON.stringify({ code: 0, data: [{}] }));
  await Promise.all([profile, upload]);
  assert.equal(storage.get("tgg_user").id, "bob");
  assert.equal(storage.has("tgg_refresh_token"), false);
});

test("refresh completing after logout cannot restore the session or retry writes", async () => {
  const { api, calls, storage } = setup();
  const pending = assert.rejects(api.request("/api/orders", { method: "POST", data: { items: [] } }), /账号已变更/);
  reply(calls[0], 401, {});
  assert.equal(calls.length, 2);
  api.clearSession();
  reply(calls[1], 200, { token: "alice-new", refreshToken: "rotated" });
  await pending;
  assert.equal(calls.length, 2);
  assert.equal(storage.has("tgg_token"), false);
});

test("concurrent and late 401 responses use one refresh and the new access token", async () => {
  const { api, calls } = setup();
  const first = api.request("/api/me");
  const second = api.request("/api/orders");
  const late = api.request("/api/payments");
  reply(calls[0], 401, {});
  reply(calls[1], 401, {});
  assert.equal(calls.length, 4);
  reply(calls[3], 200, { token: "alice-new", refreshToken: "rotated" });
  await tick();
  reply(calls[2], 401, {});
  await tick();
  assert.equal(calls.length, 7);
  for (const call of calls.slice(4)) {
    assert.equal(call.header.Authorization, "Bearer alice-new");
    reply(call, 200, {});
  }
  await Promise.all([first, second, late]);
});

test("refresh network failure retains credentials so a later attempt can recover", async () => {
  const { api, calls, storage } = setup();
  const failed = assert.rejects(api.request("/api/me"), /network/);
  reply(calls[0], 401, {});
  calls[1].fail({ errMsg: "network unavailable" });
  await failed;
  assert.equal(storage.get("tgg_refresh_token"), "alice-refresh");
  const recovered = api.request("/api/me");
  reply(calls[2], 401, {});
  reply(calls[3], 200, { token: "alice-new" });
  await tick();
  reply(calls[4], 200, { id: "alice" });
  assert.equal((await recovered).id, "alice");
});

test("an old refresh rejection cannot clear a newer login", async () => {
  const { api, calls, storage } = setup();
  const failed = assert.rejects(api.request("/api/me"), /账号已变更/);
  reply(calls[0], 401, {});
  api.saveSession({ token: "bob", refreshToken: "bob-refresh", user: { id: "bob" } });
  reply(calls[1], 401, {});
  await failed;
  assert.equal(storage.get("tgg_token"), "bob");
  assert.equal(storage.get("tgg_refresh_token"), "bob-refresh");
});

test("expired protected requests refresh first and share the new token", async () => {
  const { api, calls } = setup();
  api.saveSession({ token: "expired", expiresAt: new Date(Date.now() - 1000).toISOString(), refreshToken: "refresh", user: { id: "alice" } });
  const first = api.request("/api/coin-signin/status", { authRequired: true });
  const second = api.request("/api/coin-signin/start", { method: "POST", data: {}, authRequired: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/auth\/refresh$/);
  reply(calls[0], 200, { token: "new", expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await tick();
  assert.equal(calls.length, 3);
  for (const call of calls.slice(1)) {
    assert.equal(call.header.Authorization, "Bearer new");
    reply(call, 200, { ok: true });
  }
  await Promise.all([first, second]);
});

test("legacy cached tokens use their encoded expiry before requesting sign-in status", async () => {
  const { api, calls, storage } = setup();
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 10, nickname: "微信用户" })).toString("base64url");
  api.saveSession({ token: payload + ".signature", user: { id: "alice" } });
  await assert.rejects(api.request("/api/coin-signin/status", { authRequired: true }), { statusCode: 401 });
  assert.equal(calls.length, 0, "known expired token without refresh must not reach the server");
  assert.equal(storage.has("tgg_token"), false);
});

test("failed proactive refresh preserves credentials for a network retry", async () => {
  const { api, calls, storage } = setup();
  api.saveSession({ token: "expired", expiresAt: new Date(0).toISOString(), refreshToken: "refresh", user: { id: "alice" } });
  const pending = assert.rejects(api.request("/api/coin-signin/status", { authRequired: true }), /network/);
  calls[0].fail({ errMsg: "network unavailable" });
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(storage.get("tgg_token"), "expired");
  assert.equal(storage.get("tgg_refresh_token"), "refresh");
});

test("logout during proactive refresh prevents the protected request", async () => {
  const { api, calls, storage } = setup();
  api.saveSession({ token: "expired", expiresAt: new Date(0).toISOString(), refreshToken: "refresh", user: { id: "alice" } });
  const pending = assert.rejects(api.request("/api/coin-signin/start", { method: "POST", authRequired: true }), /账号已变更/);
  api.clearSession();
  reply(calls[0], 200, { token: "new" });
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(storage.has("tgg_token_expires_at"), false);
  assert.equal(storage.has("tgg_token"), false);
});

test("public requests stay available even when a cached token has expired", async () => {
  const { api, calls } = setup();
  api.saveSession({ token: "expired", expiresAt: new Date(0).toISOString(), user: { id: "alice" } });
  const pending = api.request("/api/home");
  assert.match(calls[0].url, /\/api\/home$/);
  reply(calls[0], 200, { ok: true });
  await pending;
});

test("profile requests without auth options refresh expired credentials before sending", async () => {
  const { api, calls } = setup();
  api.saveSession({ token: "expired", expiresAt: new Date(0).toISOString(), refreshToken: "refresh", user: { id: "alice" } });
  const pending = api.request("/api/me");
  const second = api.request("/api/me?source=balance");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/auth\/refresh$/);
  reply(calls[0], 200, { token: "renewed", expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await tick();
  assert.equal(calls.length, 3);
  for (const call of calls.slice(1)) {
    assert.equal(call.header.Authorization, "Bearer renewed");
    reply(call, 200, { id: "alice" });
  }
  await Promise.all([pending, second]);
});

test("guest profile request stops locally without sending an anonymous API request", async () => {
  const { api, calls } = setup();
  api.clearSession();
  await assert.rejects(api.request("/api/me"), { code: "AUTH_REQUIRED" });
  assert.equal(calls.length, 0);
});

test("legacy expired profile token without refresh becomes login required without HTTP 401", async () => {
  const { api, calls, storage } = setup();
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  api.saveSession({ token: payload + ".signature", user: { id: "alice" } });
  await assert.rejects(api.request("/api/me"), { code: "AUTH_REQUIRED" });
  assert.equal(calls.length, 0);
  assert.equal(storage.has("tgg_token"), false);
  assert.equal(storage.has("tgg_user"), false);
});
