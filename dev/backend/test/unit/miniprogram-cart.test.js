const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("checkout retries retain identity and cart completion removes only ordered quantities once", () => {
  const storage = new Map([["tgg_user", { id: "alice" }]]);
  const context = { module: { exports: {} }, wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/cart.js"), "utf8"), context);
  const cart = context.module.exports;
  cart.add({ id: "apple", stock: 10 }, 3);
  const items = [{ productId: "apple", quantity: 2 }];
  cart.writeCheckout(items, true);
  const key = cart.checkoutIdempotencyKey();
  cart.writeCheckout(items, true);
  assert.equal(cart.checkoutIdempotencyKey(), key);
  // Simulate adding more while the order response is in flight.
  cart.add({ id: "apple", stock: 10 });
  cart.completeCheckout(key);
  assert.equal(cart.read()[0].quantity, 2);
  cart.completeCheckout(key);
  assert.equal(cart.read()[0].quantity, 2);
  // Buy-now orders must not delete or reduce a separate cart entry.
  cart.writeCheckout(items);
  const direct = cart.checkoutIdempotencyKey();
  cart.completeCheckout(direct);
  assert.equal(cart.read()[0].quantity, 2);
  cart.writeCheckout(items, true);
  const obsolete = cart.checkoutIdempotencyKey();
  cart.writeCheckout([{ productId: "banana", quantity: 1 }]);
  cart.completeCheckout(obsolete);
  assert.equal(cart.readCheckout()[0].productId, "banana");
  assert.equal(cart.read()[0].quantity, 2);
});
test("cart and checkout drafts are isolated between accounts", () => {
  const storage = new Map();
  const context = { module: { exports: {} }, wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/cart.js"), "utf8"), context);
  const cart = context.module.exports;
  storage.set("tgg_user", { id: "alice" });
  cart.add({ id: "apple", stock: 3 });
  cart.writeCheckout([{ productId: "apple", quantity: 1 }]);
  storage.set("tgg_user", { id: "bob" });
  assert.equal(cart.read().length, 0);
  assert.equal(cart.readCheckout().length, 0);
  cart.writeCheckout([{ productId: "banana", quantity: 2 }]);
  storage.set("tgg_user", { id: "alice" });
  assert.equal(cart.readCheckout()[0].productId, "apple");
  cart.clearCheckout();
  assert.equal(cart.readCheckout().length, 0);
  assert.equal(cart.read().length, 1);
  storage.set("tgg_user", { id: "bob" });
  assert.equal(cart.readCheckout()[0].productId, "banana");
});

test("guest cart merges once into the signed-in account without affecting other accounts", () => {
  const storage = new Map();
  const context = { module: { exports: {} }, wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/cart.js"), "utf8"), context);
  const cart = context.module.exports;
  cart.add({ id: "apple", stock: 10 }, 2);
  storage.set("tgg_user", { id: "alice" });
  cart.add({ id: "apple", stock: 10 });
  cart.mergeGuestCart();
  assert.equal(cart.read()[0].quantity, 3);
  cart.mergeGuestCart();
  assert.equal(cart.read()[0].quantity, 3);
  assert.equal(storage.has("tgg_cart_guest"), false);
  storage.set("tgg_user", { id: "bob" });
  assert.equal(cart.read().length, 0);
});
