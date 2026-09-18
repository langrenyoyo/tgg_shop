const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token", tgg_config: { rewardedAdUnitId: "test-unit" } };
  const requests = [];
  let page, finishAd, cancelled = 0;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/signin/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("api") ? { request: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) } : {
      playAd: () => ({ promise: new Promise(resolve => { finishAd = resolve; }), cancel: () => { cancelled++; finishAd(); } })
    },
    wx: { getStorageSync: key => storage[key], showToast() {} }
  });
  page.setData = value => Object.assign(page.data, value);
  return { page, requests, storage, finish: () => finishAd(), cancelled: () => cancelled };
}
const session = { sessionId: "session-a", currentAdType: "reward_video", completionToken: "nonce", adRewardsAvailable: true };

test("ad completion after account switch or unload cannot submit old session progress", async () => {
  for (const change of ["account", "unload"]) {
    const context = setup();
    const { page, requests, storage } = context;
    const loading = page.load(); requests[0].resolve(session); await loading;
    const playback = page.playAd();
    if (change === "account") storage.tgg_user = { id: "bob" };
    else page.onUnload();
    context.finish(); await playback;
    assert.equal(requests.length, 1);
    if (change === "unload") assert.equal(context.cancelled(), 1);
  }
});

test("signin stale response and failed refresh cannot retain another session or allow actions", async () => {
  const { page, requests } = setup();
  const old = page.load(), latest = page.load();
  requests[1].resolve({ ...session, sessionId: "current" }); await latest;
  requests[0].resolve(session); await old;
  assert.equal(page.data.session.sessionId, "current");
  const failed = page.load(); requests[2].reject(new Error("offline")); await failed;
  assert.equal(page.data.status, null); assert.equal(page.data.session, null);
  assert.equal(page.data.error, "offline"); assert.equal(page.data.refreshing, false);
  await page.startSignin(); await page.spinLottery(); await page.playAd();
  assert.equal(requests.length, 3);
});
