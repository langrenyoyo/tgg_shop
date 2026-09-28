process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const { getHome } = require("../../src/services/catalog-service");

test("home exposes the five category shortcuts and seeded products map to fruit and vegetable", () => {
  const home = getHome(createSeed(), null);
  assert.deepEqual(home.categories, ["水果", "蔬菜", "日用", "零食", "饮料"]);
  assert.equal(home.categoryShortcuts.every(item => item.key && item.icon), true);
  const state = createSeed();
  assert.equal(state.products.some(item => item.category === "水果"), true);
  assert.equal(state.products.some(item => item.category === "蔬菜"), true);
});

test("native home category tap writes a shop filter and opens the category tab", () => {
  const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
  let page;
  const storage = new Map();
  const switched = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, "pages/home/index.js"), "utf8"), {
    Page: value => { page = value; },
    wx: { setStorageSync: (key, value) => storage.set(key, value), switchTab: value => switched.push(value.url), getStorageSync: () => null },
    require: () => ({ request: async () => ({}) })
  });
  page.goCategory({ currentTarget: { dataset: { category: "蔬菜" } } });
  assert.equal(storage.get("tgg_shop_entry").category, "蔬菜");
  assert.equal(storage.get("tgg_shop_entry").search, "");
  assert.deepEqual(switched, ["/pages/shop/index"]);
});
