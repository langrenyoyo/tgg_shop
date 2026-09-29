const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(permissions) {
  let page, cleared = false;
  const writes = [], redirects = [], messages = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/station/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ clearStationSession: () => { cleared = true; }, request: async (url, options) => {
      if (options?.method === "POST") { writes.push(url); throw Object.assign(new Error("授权已变更"), { statusCode: 401 }); }
      if (url === "/api/station/me") return { station: { permissions }, sites: [{ name: "测试站点" }] };
      if (url === "/api/station/dashboard") return { counts: {}, pickingConfig: {} };
      return [];
    } }),
    wx: { showToast: value => messages.push(value.title), reLaunch: value => redirects.push(value.url) }
  });
  page.setData = value => Object.assign(page.data, value);
  return { page, writes, redirects, messages, cleared: () => cleared };
}

test("mini station opens the authorized work view and blocks actions without a grant", async () => {
  const h = harness(["station:pickup"]);
  await h.page.load();
  assert.equal(h.page.data.view, "pickup");
  assert.equal(h.page.data.canReceive, false);
  assert.equal(h.page.data.canPickup, true);
  assert.equal(h.page.data.canException, false);
  await h.page.receiveById("order-1");
  h.page.exception({ currentTarget: { dataset: { id: "order-1" } } });
  assert.equal(h.writes.length, 0);
  assert.equal(h.messages.length, 2);
});

test("revoked authorization during a mini pickup clears pending intent and returns to login", async () => {
  const h = harness(["station:pickup"]);
  await h.page.load();
  await h.page.pickupByCode("order-1", "123456");
  assert.equal(h.cleared(), true);
  assert.equal(h.page.pickupAttempt, null);
  assert.equal(h.page.data.pendingPickup, false);
  assert.equal(h.page.data.canPickup, false);
  assert.equal(h.page.data.busy, false);
  assert.deepEqual(h.redirects, ["/pages/station-login/index"]);
});
