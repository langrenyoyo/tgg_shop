const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

function setup(name = "shop") {
  const storage = { tgg_user: { id: "alice" } }, pending = [], navigation = [], updates = [];
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../../../wechat-miniprogram/pages/${name}/index.js`), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("product-cart") ? { quantities: () => ({ apple: 2 }) } : { request: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) },
    wx: { getStorageSync: key => storage[key], removeStorageSync: key => delete storage[key], navigateTo: value => navigation.push(value) }
  });
  page.setData = (value, callback) => { updates.push(value); Object.assign(page.data, value); callback?.(); };
  return { page, storage, pending, navigation, updates };
}
const result = (start, count, hasMore = true) => ({ items: Array.from({ length: count }, (_, i) => ({ id: `p${start + i}`, name: `苹果${start + i}` })), total: 25, hasMore, categories: ["水果"] });
const tap = id => ({ currentTarget: { dataset: { id } } });

test("all category stays first, global search leaves the selected category, and selecting all clears search", async () => {
  const { page, pending } = setup();
  const { listProductPage } = require("../../src/services/catalog-service");
  const state = { products: [
    { id: "noodles", name: "方便面", category: "速食方便", status: "on" },
    { id: "chips", name: "乐事薯片", category: "薯片膨化", status: "on" },
    { id: "off", name: "下架薯片", category: "薯片膨化", status: "off" }
  ] };
  async function complete(task) {
    const request = pending.at(-1);
    const query = Object.fromEntries(new URL(request.url, "http://localhost").searchParams);
    request.resolve(listProductPage(state, { ...query, page: Number(query.page), pageSize: Number(query.pageSize) }));
    await task;
  }
  await complete(page.onShow());
  assert.equal(page.data.category, "全部");
  assert.equal(page.data.categories[0], "全部");
  assert.equal(page.data.products.length, 2);
  await complete(page.category({ currentTarget: { dataset: { category: "速食方便" } } }));
  assert.equal(page.data.products[0].id, "noodles");
  await complete(page.search({ detail: { value: "薯片" } }));
  assert.equal(page.data.category, "全部");
  assert.equal(page.data.products.length, 1);
  assert.equal(page.data.products[0].id, "chips");
  page.open(tap("chips"));
  const count = pending.length;
  page.onShow();
  assert.equal(pending.length, count);
  assert.equal(page.data.category, "全部");
  assert.equal(page.data.search, "薯片");
  await complete(page.category({ currentTarget: { dataset: { category: "全部" } } }));
  assert.equal(page.data.search, "");
  assert.equal(page.data.products.length, 2);
});

test("search entry uses all categories and an empty result retains the all category", async () => {
  const { page, pending, storage } = setup();
  storage.tgg_shop_entry = { category: "速食方便", search: "不存在的商品" };
  const task = page.onShow();
  assert.equal(page.data.category, "全部");
  pending[0].resolve({ items: [], total: 0, hasMore: false, categories: ["全部", "速食方便"] });
  await task;
  assert.equal(page.data.products.length, 0);
  assert.equal(page.data.categories.filter(item => item === "全部").length, 1);
  const clear = page.search({ detail: { value: "" } });
  assert.equal(page.data.category, "全部");
  assert.equal(new URL(pending[1].url, "http://localhost").searchParams.get("search"), "");
  pending[1].resolve(result(0, 10)); await clear;
});

test("shop appends ten items without blanking, prevents concurrent loads and retries the same failed page", async () => {
  const { page, pending } = setup();
  const first = page.onShow();
  assert.match(pending[0].url, /page=1&pageSize=10/);
  pending[0].resolve(result(0, 10)); await first;
  page.onProductScroll({ detail: { scrollTop: 750 } });
  const next = page.loadMore(); page.loadMore();
  assert.equal(pending.length, 2);
  assert.equal(page.data.products.length, 10);
  assert.equal(page.data.loading, false);
  pending[1].reject(new Error("offline")); await next;
  assert.equal(page.data.products.length, 10);
  assert.equal(page.data.moreError, "offline");
  const retry = page.loadMore();
  assert.equal(pending[2].url, pending[1].url);
  pending[2].resolve(result(10, 10)); await retry;
  assert.equal(page.data.products.length, 20);
  assert.equal(page.productScrollTop, 750);
  const last = page.loadMore(); pending[3].resolve(result(20, 5, false)); await last;
  page.loadMore();
  assert.equal(pending.length, 4);
  assert.equal(page.data.products.length, 25);
  assert.equal(new Set(page.data.products.map(item => item.id)).size, 25);
});

test("new filters reset pagination and ignore stale append results", async () => {
  const { page, pending } = setup();
  const first = page.load(); pending[0].resolve(result(0, 10)); await first;
  const more = page.loadMore();
  page.onProductScroll({ detail: { scrollTop: 900 } });
  const filtered = page.category({ currentTarget: { dataset: { category: "纯积分兑换" } } });
  assert.equal(page.data.scrollTop, 0);
  assert.equal(page.data.products.length, 0);
  assert.match(pending[2].url, /page=1&pageSize=10/);
  assert.equal(new URL(pending[2].url, "http://localhost").searchParams.get("category"), "纯积分兑换");
  pending[2].resolve(result(100, 2, false)); await filtered;
  pending[1].resolve(result(10, 10)); await more;
  assert.equal(page.data.products.length, 2);
  assert.equal(page.data.products[0].id, "p100");
  assert.equal(page.data.hasMore, false);
  const searched = page.search({ detail: { value: "苹果 & #" } });
  assert.equal(page.data.category, "全部");
  assert.equal(new URL(pending[3].url, "http://localhost").searchParams.get("category"), "全部");
  assert.equal(new URL(pending[3].url, "http://localhost").searchParams.get("search"), "苹果 & #");
  pending[3].resolve(result(200, 0, false)); await searched;
});

for (const name of ["home", "shop"]) test(`${name} keeps rendered products on detail return but reloads after account change`, async () => {
  const { page, pending, storage, updates } = setup(name);
  const first = page.onShow();
  pending[0].resolve(name === "shop" ? result(0, 10) : { recommendProducts: result(0, 4).items }); await first;
  const displayed = name === "shop" ? page.data.products : page.data.home;
  if (name === "shop") page.onProductScroll({ detail: { scrollTop: 777 } });
  const open = () => name === "shop" ? page.open(tap("p0")) : page.openProduct(tap("p0"));
  open();
  updates.length = 0;
  page.onShow();
  assert.equal(pending.length, 1);
  assert.equal(name === "shop" ? page.data.products : page.data.home, displayed);
  assert.ok(updates.every(value => !("products" in value) && !("home" in value) && !("scrollTop" in value)));
  assert.equal(page.data.cartQuantities.apple, 2);
  if (name === "shop") assert.equal(page.productScrollTop, 777);
  open(); storage.tgg_user = { id: "bob" };
  const reload = page.onShow();
  assert.equal(pending.length, 2);
  pending[1].resolve(name === "shop" ? result(0, 0, false) : {}); await reload;
});

test("explicit shop entry wins over a saved return and unloading discards a pending page", async () => {
  const { page, pending, storage } = setup();
  const first = page.onShow(); pending[0].resolve(result(0, 10)); await first;
  page.open(tap("p0"));
  storage.tgg_shop_entry = { category: "水果", search: "" };
  const reload = page.onShow();
  assert.equal(page.data.category, "水果");
  assert.equal(storage.tgg_shop_entry, undefined);
  page.onUnload();
  pending[1].resolve(result(0, 10)); await reload;
  assert.equal(page.data.products.length, 0);
});
