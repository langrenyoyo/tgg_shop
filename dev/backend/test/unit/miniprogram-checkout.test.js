const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

for (const scenario of [
  { name: "no fulfillment enabled", config: {}, sites: [], blocked: true },
  { name: "pickup enabled without sites", config: { pickupEnabled: true }, sites: [], blocked: true },
  { name: "missing pickup sites falls back to delivery", config: { pickupEnabled: true, deliveryEnabled: true }, sites: [], type: "delivery" },
  { name: "enabled pickup site", config: { pickupEnabled: true }, sites: [{ id: "site-1" }], type: "pickup" }
]) {
  test(`checkout: ${scenario.name}`, async () => {
    let page;
    const writes = [];
    const resources = {
      "/api/me": { id: "alice", points: 1000 },
      "/api/config": scenario.config,
      "/api/pickup-sites": scenario.sites,
      "/api/products": [{ id: "apple", supportsPoints: true, pointsPrice: 10 }]
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
      wx: { showToast() {}, redirectTo() {}, getStorageSync: () => ({ id: "alice" }) }
    });
    page.setData = (data, callback) => { Object.assign(page.data, data); callback?.(); };
    page.ownerId = "alice";
    page.idempotencyKey = "checkout-test";
    await page.load();
    assert.equal(Boolean(page.data.fulfillmentError), Boolean(scenario.blocked));
    if (scenario.type) assert.equal(page.data.fulfillmentType, scenario.type);
    page.data.deliveryAddress = "收货人 电话 地址";
    await page.submit();
    assert.equal(writes.length, scenario.blocked ? 0 : 1);
    if (writes.length) assert.equal(writes[0].fulfillmentType, scenario.type);
  });
}
