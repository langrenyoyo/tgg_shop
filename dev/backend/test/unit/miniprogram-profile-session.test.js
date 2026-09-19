const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
const tick = () => new Promise(setImmediate);

function setup({ token = "old", refreshToken = "refresh" } = {}) {
  const storage = new Map(), calls = [], navigation = [];
  const app = { globalData: {} };
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => calls.push(options),
    navigateTo: options => navigation.push(options.url)
  };
  const context = { module: { exports: {} }, wx, getApp: () => app, require: () => ({ develop: "https://example.test" }) };
  vm.runInNewContext(fs.readFileSync(path.join(root, "utils/api.js"), "utf8"), context);
  const api = context.module.exports;
  if (token) api.saveSession({ token, refreshToken, user: { id: "alice", points: 100 } });
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, "pages/me/index.js"), "utf8"), {
    wx, require: () => api, Page: value => { page = value; }
  });
  page.setData = values => Object.assign(page.data, values);
  return { api, page, calls, storage, navigation, app };
}

function reply(call, statusCode, data = {}) { return call.success({ statusCode, data }); }
function assertSignedOut(h) {
  assert.equal(h.storage.has("tgg_token"), false);
  assert.equal(h.storage.has("tgg_refresh_token"), false);
  assert.equal(h.storage.has("tgg_user"), false);
  assert.equal(h.app.globalData.user, null);
  assert.equal(h.page.data.loggedIn, false);
  assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.error, "");
  assert.equal(h.page.data.user.id, undefined);
  assert.equal(h.page.data.avatarPreview, "");
  assert.match(h.page.data.authNotice, /重新登录/);
  h.page.goLogin();
  assert.equal(h.navigation.at(-1), "/pages/login/index");
}

test("profile makes no protected request for a guest", async () => {
  const h = setup({ token: "" });
  await h.page.load();
  assert.equal(h.calls.length, 0);
  assert.equal(h.page.data.loggedIn, false);
  assert.equal(h.page.data.error, "");
});

test("expired legacy login becomes a login prompt and can recover after new login", async () => {
  const h = setup({ refreshToken: "" });
  const loading = h.page.load();
  await reply(h.calls[0], 401, { error: "登录状态无效" });
  await loading;
  assertSignedOut(h);
  assert.equal(h.calls.length, 1);
  await h.page.load();
  assert.equal(h.calls.length, 1, "reopening the tab must not retry an invalid token");
  h.api.saveSession({ token: "new-login", user: { id: "alice" } });
  const recovered = h.page.load();
  await reply(h.calls[1], 200, { id: "alice", points: 250 });
  await recovered;
  assert.equal(h.page.data.user.points, 250);
  assert.equal(h.page.data.loggedIn, true);
  assert.equal(h.page.data.authNotice, "");
});

test("a refreshable access token recovers profile without a login prompt", async () => {
  const h = setup();
  const loading = h.page.load();
  const first = reply(h.calls[0], 401);
  await reply(h.calls[1], 200, { token: "renewed", refreshToken: "rotated" });
  await first;
  assert.equal(h.calls[2].header.Authorization, "Bearer renewed");
  await reply(h.calls[2], 200, { id: "alice", points: 250 });
  await loading;
  assert.equal(h.page.data.user.points, 250);
  assert.equal(h.page.data.loggedIn, true);
  assert.equal(h.page.data.authNotice, "");
});

test("expired refresh token clears the profile session and offers login", async () => {
  const h = setup();
  const loading = h.page.load();
  const first = reply(h.calls[0], 401);
  await reply(h.calls[1], 401, { error: "刷新令牌无效或已过期" });
  await first;
  await loading;
  assertSignedOut(h);
  assert.equal(h.calls.length, 2);
});

test("a rejected refreshed token clears credentials instead of trapping profile in retry", async () => {
  const h = setup();
  const loading = h.page.load();
  const first = reply(h.calls[0], 401);
  await reply(h.calls[1], 200, { token: "renewed", refreshToken: "rotated" });
  await first;
  await reply(h.calls[2], 401, { error: "登录会话已失效" });
  await loading;
  assertSignedOut(h);
  assert.equal(h.calls.length, 3, "must not keep refreshing a rejected session");
});

test("a network failure during refresh retains the session and shows a retryable error", async () => {
  const h = setup();
  const loading = h.page.load();
  const first = reply(h.calls[0], 401);
  h.calls[1].fail({ errMsg: "network unavailable" });
  await first;
  await loading;
  assert.equal(h.storage.get("tgg_token"), "old");
  assert.equal(h.page.data.loggedIn, true);
  assert.equal(h.page.data.authNotice, "");
  assert.match(h.page.data.error, /network/);
});

test("a late rejected retry cannot clear a newly logged-in account", async () => {
  const h = setup();
  const loading = h.page.load();
  const first = reply(h.calls[0], 401);
  await reply(h.calls[1], 200, { token: "renewed" });
  await first;
  h.api.saveSession({ token: "bob", user: { id: "bob" } });
  await reply(h.calls[2], 401);
  await tick();
  await loading;
  assert.equal(h.storage.get("tgg_token"), "bob");
  assert.equal(h.page.data.authNotice, "");
  assert.equal(h.page.data.error, "");
});
