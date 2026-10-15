const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const storage = new Map([["tgg_token", "customer-token"]]);
  const calls = [];
  const app = { globalData: {} };
  const context = { module: { exports: {} }, require: () => ({ getBaseUrl: () => "https://example.test" }), getApp: () => app, wx: {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => calls.push(options)
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/station-api.js"), "utf8"), context);
  const api = context.module.exports;
  api.saveStationSession({ token: "alice-old", refreshToken: "alice-refresh", station: { id: "alice" } });
  return { api, storage, calls };
}
const tick = () => new Promise(setImmediate);
const reply = (call, statusCode, data) => call.success({ statusCode, data });

test("station refresh after logout cannot restore credentials or retry a write", async () => {
  const { api, calls, storage } = setup();
  const pending = assert.rejects(api.request("/api/station/orders/one/receive", { method: "POST", data: {} }), /账号已变更/);
  reply(calls[0], 401, {});
  api.clearStationSession();
  reply(calls[1], 200, { token: "alice-new", refreshToken: "rotated" });
  await tick();
  // Drain an incorrectly retried request so the regression fails without hanging.
  for (const call of calls.slice(2)) reply(call, 200, {});
  await pending;
  assert.equal(calls.length, 2);
  assert.equal(storage.has("tgg_station_token"), false);
  assert.equal(storage.get("tgg_token"), "customer-token");
});

test("station concurrent and late 401 responses share the rotated session", async () => {
  const { api, calls } = setup();
  const pending = [api.request("/api/station/me"), api.request("/api/station/orders"), api.request("/api/station/dashboard")];
  reply(calls[0], 401, {});
  reply(calls[1], 401, {});
  assert.equal(calls.length, 4);
  reply(calls[3], 200, { token: "alice-new", refreshToken: "rotated" });
  await tick();
  reply(calls[2], 401, {});
  await tick();
  const extraRefresh = calls.slice(4).find(call => call.url.endsWith("/auth/refresh"));
  if (extraRefresh) { reply(extraRefresh, 200, { token: "alice-new" }); await tick(); }
  for (const call of calls.slice(4).filter(call => !call.url.endsWith("/auth/refresh"))) reply(call, 200, {});
  await Promise.all(pending);
  assert.equal(calls.filter(call => call.url.endsWith("/auth/refresh")).length, 1);
});

test("station responses and refresh failures cannot cross a worker login boundary", async () => {
  const { api, calls, storage } = setup();
  const stale = assert.rejects(api.request("/api/station/orders"), /账号已变更/);
  const refresh = assert.rejects(api.request("/api/station/me"), /账号已变更/);
  reply(calls[1], 401, {});
  api.saveStationSession({ token: "bob", station: { id: "bob" } });
  reply(calls[0], 200, [{ id: "alice-order" }]);
  reply(calls[2], 401, {});
  await Promise.all([stale, refresh]);
  assert.equal(storage.get("tgg_station_token"), "bob");
  assert.equal(storage.has("tgg_station_refresh_token"), false);
});

test("station refresh network errors allow recovery, invalid credentials require login", async () => {
  const { api, calls, storage } = setup();
  const failed = assert.rejects(api.request("/api/station/me"), /network/);
  reply(calls[0], 401, {});
  calls[1].fail({ errMsg: "network unavailable" });
  await failed;
  assert.equal(storage.get("tgg_station_refresh_token"), "alice-refresh");
  const expired = assert.rejects(api.request("/api/station/me"), error => error.statusCode === 401);
  reply(calls[2], 401, {});
  reply(calls[3], 401, {});
  await expired;
  assert.equal(storage.has("tgg_station_token"), false);
  assert.equal(storage.get("tgg_token"), "customer-token");
});
