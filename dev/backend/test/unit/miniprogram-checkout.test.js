const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

for (const scenario of [
  { name: "no fulfillment enabled", config: {}, sites: [], blocked: true },
  { name: "nonmember cannot checkout", config: { pickupEnabled: true }, sites: [{ id: "site-1" }], nonmember: true, type: "pickup" },
  { name: "pickup enabled without sites", config: { pickupEnabled: true }, sites: [], blocked: true },
  { name: "missing pickup sites falls back to delivery", config: { pickupEnabled: true, deliveryEnabled: true, deliveryTimeSlots: ["09:00-11:00"] }, sites: [], type: "delivery" },
  { name: "delivery without slots is blocked", config: { deliveryEnabled: true, deliveryTimeSlots: [] }, sites: [], blocked: true },
  { name: "enabled pickup site", config: { pickupEnabled: true }, sites: [{ id: "site-1" }], type: "pickup" }
]) {
  test(`checkout: ${scenario.name}`, async () => {
    let page;
    const writes = [];
    const resources = {
      "/api/me": { id: "alice", points: 1000, isMember: !scenario.nonmember },
      "/api/config": scenario.config,
      "/api/pickup-sites": scenario.sites,
      "/api/products": [{ id: "apple", supportsCash: true, supportsPoints: false, purePointsOnly: false, cashPrice: 1, pointsPrice: 10 }]
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/checkout/index.js"), "utf8"), {
      Page: value => { page = value; },
      require: name => name.endsWith("/api") ? { request: async (url, options) => {
        if (options?.method === "POST") { writes.push(options.data); return { id: "order-1" }; }
        return resources[url];
      } } : {
        readCheckout: () => [{ productId: "apple", quantity: 1 }],
        read: () => [], write() {}, clearCheckout() {}, checkoutIdempotencyKey: () => "checkout-test", completeCheckout() {}, readCheckoutAttempt: () => null, writeCheckoutAttempt() {}
      },
      wx: { showToast() {}, redirectTo() {}, navigateTo({ url }) { assert.equal(url, "/pages/membership/index"); }, getStorageSync: () => ({ id: "alice" }) }
    });
    page.setData = (data, callback) => { Object.assign(page.data, data); callback?.(); };
    page.ownerId = "alice";
    page.idempotencyKey = "checkout-test";
    await page.load();
    assert.equal(Boolean(page.data.fulfillmentError), Boolean(scenario.blocked));
    if (scenario.type) assert.equal(page.data.fulfillmentType, scenario.type);
    page.data.deliveryAddress = "收货人 电话 地址";
    await page.submit();
    assert.equal(writes.length, scenario.blocked || scenario.nonmember ? 0 : 1);
    if (scenario.nonmember) assert.equal(page.data.modes.length, 0);
    if (writes.length) assert.equal(writes[0].fulfillmentType, scenario.type);
  });
}

test("checkout keeps the expired-session error visible with a login action", async () => {
  let page;
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token" };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/checkout/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("cart") ? {
      checkoutIdempotencyKey: () => "checkout-test", readCheckoutAttempt: () => null,
      readCheckout: () => [{ productId: "apple", quantity: 1 }]
    } : { request: async url => {
      if (url === "/api/me") {
        delete storage.tgg_user;
        delete storage.tgg_token;
        const error = new Error("登录已失效，请重新登录");
        error.statusCode = 401;
        throw error;
      }
      if (url === "/api/config") return {};
      if (url === "/api/pickup-sites") return [];
      if (url === "/api/products") return [];
      return [];
    } },
    wx: { getStorageSync: key => storage[key], navigateTo() {} }
  });
  page.setData = value => Object.assign(page.data, value);
  page.ownerId = "alice";
  page.idempotencyKey = "checkout-test";

  await page.load();

  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, "登录已失效，请重新登录");
  assert.equal(page.data.needLogin, true);
});
