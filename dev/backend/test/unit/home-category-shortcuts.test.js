process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const { getHome } = require("../../src/services/catalog-service");
const admin = require("../../src/services/admin-service");
const actor = { role: { id: "super_admin", permissions: ["*"] } };

test("native home resolves uploaded logos while keeping bundled icons and category navigation", async () => {
  let page;
  const storage = new Map();
  const state = createSeed();
  admin.updateConfig(state, { homeCategoryShortcuts: [
    { key: "fresh", category: "水果", name: "鲜果", icon: "/uploads/fresh.png", sort: 1 },
    { key: "daily", category: "日用", name: "日用", icon: "/assets/icons/category-daily.png", sort: 2 },
    { key: "hidden", category: "蔬菜", name: "蔬菜", enabled: false, sort: 0 }
  ] }, actor);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/home/index.js"), "utf8"), {
    Page: value => { page = value; },
    wx: { getStorageSync: () => null, setStorageSync: (key, value) => storage.set(key, value), switchTab: () => {} },
    require: () => ({ request: async () => getHome(state, null), resolveAssetUrl: value => value ? `https://shop.example${value}` : "" })
  });
  page.setData = value => Object.assign(page.data, value);
  await page.load();
  assert.equal(page.data.home.categories.length, 2);
  assert.equal(page.data.home.categories[0].name, "鲜果");
  assert.equal(page.data.home.categories[0].icon, "https://shop.example/uploads/fresh.png");
  assert.equal(page.data.home.categories[1].icon, "/assets/icons/category-daily.png");
  page.goCategory({ currentTarget: { dataset: page.data.home.categories[0] } });
  assert.equal(storage.get("tgg_shop_entry").category, "水果");
});

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

test("admin can rename, reorder, disable and replace a home category logo", () => {
  const state = createSeed();
  const result = admin.updateConfig(state, {
    homeCategoryShortcuts: [
      { key: "fresh", category: "水果", name: "鲜果", icon: "/uploads/fresh.png", sort: 2, enabled: true },
      { key: "greens", category: "蔬菜", name: "绿叶菜", icon: "/uploads/greens.png", sort: 1, enabled: false }
    ], reason: "首页分类调整"
  }, actor);
  assert.equal(result.homeCategoryShortcuts.find(item => item.key === "fresh").name, "鲜果");
  const home = getHome(state, null);
  assert.deepEqual(home.categories, ["鲜果"]);
  assert.equal(home.categoryShortcuts[0].icon, "/uploads/fresh.png");
  const before = JSON.stringify(state.config.homeCategoryShortcuts);
  const invalid = admin.updateConfig(state, { homeCategoryShortcuts: [{ key: "bad", category: "水果", name: "", icon: "/uploads/x.png" }], reason: "invalid" }, actor);
  assert.equal(invalid.ok, false);
  assert.equal(JSON.stringify(state.config.homeCategoryShortcuts), before);
});
