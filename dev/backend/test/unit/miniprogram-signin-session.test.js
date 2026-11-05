const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
const tick = () => new Promise(setImmediate);
function setup({ guest = false, refreshToken = "" } = {}) {
  const storage = new Map(), calls = [], navigation = [];
  const app = { globalData: {} };
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => calls.push(options),
    navigateTo: options => navigation.push(options.url),
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}
  };
  const context = { module: { exports: {} }, wx, getApp: () => app, require: () => ({ develop: "https://example.test" }) };
  vm.runInNewContext(fs.readFileSync(path.join(root, "utils/api.js"), "utf8"), context);
  const api = context.module.exports;
  if (!guest) api.saveSession({ token: "old", refreshToken, user: { id: "alice" } });
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, "pages/coin-signin/index.js"), "utf8"), {
    wx, require: name => name.endsWith("/api") ? api : { showSigninAd() { throw Error("unexpected ad"); } },
    Page: value => { page = value; }, setInterval: () => 1, clearInterval() {}
  });
  page.setData = values => Object.assign(page.data, values);
  page.owner = guest ? undefined : "alice"; page.hidden = false;
  return { api, page, calls, storage, navigation };
}
function reply(call, statusCode, data = {}) { return call.success({ statusCode, data }); }
function status() {
  return { config: { rewardCoins: 10 }, balanceCoins: 20, unavailableReason: "", serverNow: Date.now(),
    session: { id: "session", rounds: 2, completedRounds: 2, claimed: false } };
}
async function load(h) {
  const pending = h.page.load();
  await reply(h.calls.at(-1), 200, status());
  await pending;
}
function assertLoginRequired(h) {
  assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.needLogin, true);
  assert.equal(h.page.data.sheet, "");
  assert.equal(h.page.data.session, null);
  assert.equal(h.page.data.balanceCoins, 0);
  assert.equal(h.page.data.pendingStep, false);
  assert.match(h.page.data.error, /重新登录/);
  assert.equal(h.storage.has("tgg_token"), false);
  assert.equal(h.storage.has("tgg_coin_signin_step:alice"), false);
}

test("guest sign-in page makes no protected request", async () => {
  const h = setup({ guest: true });
  await h.page.load();
  assert.equal(h.calls.length, 0);
  assert.equal(h.page.data.needLogin, true);
});

test("rejected sign-in status offers login and resumes after a fresh login", async () => {
  const h = setup();
  const pending = h.page.load();
  await reply(h.calls[0], 401);
  await pending;
  assertLoginRequired(h);
  await h.page.load();
  assert.equal(h.calls.length, 1, "invalid credentials must not be retried on reload");
  h.page.login();
  assert.equal(h.navigation.at(-1), "/pages/login/index");
  h.api.saveSession({ token: "new", user: { id: "alice" } });
  await load(h);
  assert.equal(h.page.data.needLogin, false);
  assert.equal(h.page.data.session.completedRounds, 2);
});

for (const action of ["openSignin", "getRound", "retryVerification", "claim"]) {
  test(`expired login during ${action} clears busy state and opens the login prompt`, async () => {
    const h = setup();
    await load(h);
    h.page.setData({ session: { ...status().session, completedRounds: action === "claim" ? 2 : 0 } });
    if (action === "retryVerification") {
      h.storage.set("tgg_coin_signin_step:alice", { sessionId: "session", attemptId: "attempt", stepId: "step" });
      h.page.setData({ pendingStep: true });
    }
    const pending = h.page[action]();
    assert.equal(h.page.data.busy, true);
    await reply(h.calls.at(-1), 401);
    await pending;
    assertLoginRequired(h);
  });
}

test("an expired refresh token returns sign-in to a usable login prompt", async () => {
  const h = setup({ refreshToken: "refresh" });
  await load(h);
  const pending = h.page.claim();
  const first = reply(h.calls.at(-1), 401);
  await reply(h.calls.at(-1), 401);
  await first; await pending;
  assertLoginRequired(h);
});

test("refreshable sign-in request succeeds without showing a login prompt", async () => {
  const h = setup({ refreshToken: "refresh" });
  const pending = h.page.load();
  const first = reply(h.calls[0], 401);
  await reply(h.calls[1], 200, { token: "new", refreshToken: "rotated" });
  await first;
  assert.equal(h.calls[2].header.Authorization, "Bearer new");
  await reply(h.calls[2], 200, status());
  await pending;
  assert.equal(h.page.data.needLogin, false);
  assert.equal(h.page.data.balanceCoins, 20);
});

test("a late rejection cannot reset sign-in for a newly logged-in account", async () => {
  const h = setup();
  await load(h);
  const pending = h.page.claim();
  const oldCall = h.calls.at(-1);
  h.api.saveSession({ token: "bob-token", user: { id: "bob" } });
  h.page.onShow();
  await reply(h.calls.at(-1), 200, { ...status(), balanceCoins: 99 });
  await tick();
  await reply(oldCall, 401);
  await pending;
  assert.equal(h.page.data.needLogin, false);
  assert.equal(h.page.data.balanceCoins, 99);
  assert.equal(h.storage.get("tgg_token"), "bob-token");
});

test("a network failure while claiming preserves progress and releases the busy state", async () => {
  const h = setup();
  await load(h);
  const pending = h.page.claim();
  h.calls.at(-1).fail({ errMsg: "network unavailable" });
  await pending;
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.needLogin, false);
  assert.equal(h.page.data.session.completedRounds, 2);
  assert.match(h.page.data.error, /奖励结果待确认/);
});
