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
    uploadFile: options => calls.push(options)
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
