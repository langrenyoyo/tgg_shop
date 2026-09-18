const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function setup() {
  let page;
  const pending = [], navigation = [], drafts = [], adds = [];
  const storage = { tgg_token: "token" };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/product/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("cart") ? { add: value => adds.push(value), writeCheckout: value => drafts.push(value) } : { request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    wx: { getStorageSync: key => storage[key], navigateTo: value => navigation.push(value), showToast() {} }
  });
  page.setData = value => Object.assign(page.data, value);
  page.onLoad({ id: "apple" });
  return { page, pending, navigation, drafts, adds, storage };
}
const product = { id: "apple", stock: 3, status: "on" };
test("failed and stale product fetches cannot enable unavailable purchases", async () => {
  const { page, pending, drafts, adds } = setup();
  const old = page.load(), latest = page.load();
  pending[1].resolve({ ...product, status: "off" }); await latest;
  pending[0].resolve(product); await old;
  page.buy(); page.add();
  assert.equal(drafts.length, 0); assert.equal(adds.length, 0);
  const fail = page.load(); pending[2].reject(new Error("offline")); await fail;
  assert.equal(page.data.product, null); assert.equal(page.data.error, "offline");
  page.buy(); assert.equal(drafts.length, 0);
});
test("purchase navigation locks duplicate taps and navigation failure can retry", async () => {
  const { page, pending, drafts, navigation } = setup();
  const load = page.load(); pending[0].resolve(product); await load;
  page.buy(); page.buy();
  assert.equal(drafts.length, 1); assert.equal(navigation.length, 1);
  assert.equal(navigation[0].url, "/pages/checkout/index");
  navigation[0].fail();
  page.buy(); assert.equal(navigation.length, 2);
});
test("guest purchase opens login without checkout draft and mismatched response is rejected", async () => {
  const { page, pending, drafts, navigation, storage } = setup();
  delete storage.tgg_token;
  const load = page.load(); pending[0].resolve(product); await load;
  page.buy(); assert.equal(navigation[0].url, "/pages/login/index"); assert.equal(drafts.length, 0);
  const wrong = page.load(); pending[1].resolve({ ...product, id: "banana" }); await wrong;
  assert.equal(page.data.product, null); assert.match(page.data.error, /不匹配/);
});
