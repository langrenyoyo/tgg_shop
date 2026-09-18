process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");

test("order replay rejects changed intent without further stock or balance mutation", () => {
  const state = createSeed();
  const payload = { idempotencyKey: "intent", paymentMode: "pure_points", fulfillmentType: "delivery", deliveryAddress: "地址 A", items: [{ productId: "p_banana", quantity: 1 }] };
  const original = createOrder(state, "u_1001", payload);
  assert.equal(original.ok, true);
  const before = JSON.stringify(state);
  for (const change of [{ deliveryAddress: "地址 B" }, { paymentMode: "cash" }, { fulfillmentType: "pickup" }, { items: [{ productId: "p_banana", quantity: 2 }] }]) {
    assert.equal(createOrder(state, "u_1001", { ...payload, ...change }).status, 409);
    assert.equal(JSON.stringify(state), before);
  }
  assert.equal(createOrder(state, "u_1001", payload).idempotent, true);
});

test("uncertain checkout reopens with exact original payload and ignores changed controls", async () => {
  const storage = new Map([["tgg_user", { id: "alice" }], ["tgg_token", "token"]]);
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key), showToast() {}, redirectTo() {} };
  const cartContext = { module: { exports: {} }, wx };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/cart.js"), "utf8"), cartContext);
  const cart = cartContext.module.exports;
  cart.writeCheckout([{ productId: "apple", quantity: 1 }]);
  const attempts = [];
  let succeed = false;
  function open() {
    let page;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/checkout/index.js"), "utf8"), {
      Page: value => { page = value; }, wx,
      require: name => name.endsWith("cart") ? cart : { request: async (url, options) => {
        if (options) { attempts.push(structuredClone(options.data)); if (!succeed) throw new Error("response lost"); return { id: "order1" }; }
        return { "/api/me": { id: "alice", points: 100 }, "/api/config": { deliveryEnabled: true }, "/api/pickup-sites": [], "/api/products": [{ id: "apple", supportsPoints: true, pointsPrice: 10 }] }[url];
      } }
    });
    page.setData = (value, callback) => { Object.assign(page.data, value); callback?.(); };
    page.onLoad(); return page;
  }
  const first = open(); await new Promise(setImmediate);
  first.address({ detail: { value: "地址 A" } }); await first.submit();
  assert.equal(cart.readCheckoutAttempt().deliveryAddress, "地址 A");
  const second = open(); await new Promise(setImmediate);
  second.address({ detail: { value: "地址 B" } });
  succeed = true; await second.submit();
  assert.equal(JSON.stringify(attempts[1]), JSON.stringify(attempts[0]));
  assert.equal(cart.readCheckoutAttempt(), null);
});
