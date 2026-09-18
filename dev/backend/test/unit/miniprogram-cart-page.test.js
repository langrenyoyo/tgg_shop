const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token" };
  const carts = { alice: [{ productId: "apple", quantity: 1, selected: true }], bob: [{ productId: "banana", quantity: 2, selected: true }] };
  const pending = [], drafts = [], navigation = [], messages = [];
  const owner = () => storage.tgg_user?.id || "guest";
  const cart = { read: () => structuredClone(carts[owner()] || []), write: value => { carts[owner()] = structuredClone(value); }, writeCheckout: value => drafts.push({ owner: owner(), items: value }) };
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/cart/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("cart") ? cart : { request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    wx: { getStorageSync: key => storage[key], navigateTo: value => navigation.push(value.url), showToast: value => messages.push(value.title) }
  });
  page.setData = value => Object.assign(page.data, value);
  return { page, storage, carts, pending, drafts, navigation, messages };
}
const products = [{ id: "apple", stock: 3 }, { id: "banana", stock: 5 }];

test("old cart events cannot edit or create checkout drafts for a new account", async () => {
  const { page, storage, pending, drafts, carts } = setup();
  const first = page.load(); pending[0].resolve(products); await first;
  storage.tgg_user = { id: "bob" };
  page.checkout();
  assert.equal(drafts.length, 0);
  assert.equal(page.data.items.length, 0);
  page.remove({ currentTarget: { dataset: { id: "banana" } } });
  assert.equal(carts.bob.length, 1);
  pending[1].resolve(products); await new Promise(setImmediate);
  assert.equal(page.data.items[0].productId, "banana");
  page.checkout();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].owner, "bob");
  assert.equal(drafts[0].items[0].productId, "banana");
});

test("outdated cart requests and failed product loading cannot enable checkout", async () => {
  const { page, pending, drafts } = setup();
  const first = page.load(), second = page.load();
  pending[1].resolve([]); await second;
  pending[0].resolve(products); await first;
  assert.equal(page.data.items[0].product, null);
  page.checkout(); assert.equal(drafts.length, 0);
  const failed = page.load(); pending[2].reject(new Error("offline")); await failed;
  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.error, "offline");
  page.checkout(); assert.equal(drafts.length, 0);
});

test("checkout detects changed stored quantities and quantity controls reject stock overflow", async () => {
  const { page, pending, drafts, carts, messages } = setup();
  const first = page.load(); pending[0].resolve(products); await first;
  carts.alice[0].quantity = 3;
  page.checkout();
  assert.equal(drafts.length, 0);
  assert.equal(messages.at(-1), "购物车已更新，请重新确认");
  pending[1].resolve(products); await new Promise(setImmediate);
  page.quantity({ currentTarget: { dataset: { id: "apple", delta: "1" } } });
  assert.equal(carts.alice[0].quantity, 3);
  assert.equal(messages.at(-1), "库存不足或商品已下架");
  page.checkout();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].items[0].quantity, 3);
});
