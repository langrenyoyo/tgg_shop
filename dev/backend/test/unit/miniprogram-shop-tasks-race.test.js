const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

function page(name, responses) {
  let definition; const pending = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../../../wechat-miniprogram/pages/${name}/index.js`), "utf8"), { Page: value => { definition = value; }, wx: { getStorageSync: () => null }, require: () => ({ request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }) });
  definition.setData = (value, cb) => { Object.assign(definition.data, value); cb?.(); };
  return { definition, pending };
}

test("shop ignores stale product response and clears old products during reload", async () => {
  const h = page("shop"); h.definition.data.allProducts = [{ id: "old" }];
  const first = h.definition.load(); const second = h.definition.load();
  h.pending[1].resolve([{ id: "new", name: "新商品", category: "fruit" }]); await second;
  h.pending[0].resolve([{ id: "stale" }]); await first;
  assert.equal(h.definition.data.allProducts[0].id, "new");
  assert.equal(h.definition.data.products[0].id, "new");
  const failed = h.definition.load(); assert.equal(h.definition.data.products.length, 0); h.pending[2].reject(new Error("offline")); await failed;
  assert.equal(h.definition.data.error, "offline"); assert.equal(h.definition.data.loading, false);
});

test("task page clears old task records before a new first page response", async () => {
  const h = page("tasks"); h.definition.data.tasks = [{ id: "old" }];
  const load = h.definition.load(); assert.equal(h.definition.data.tasks.length, 0);
  h.pending[0].resolve([]); h.pending[1].resolve([{ id: "new" }]); await load;
  assert.equal(h.definition.data.tasks[0].id, "new");
});

test("shop tolerates a malformed product row without crashing the page", () => {
  const h = page("shop");
  h.definition.data.allProducts = [{ id: "bad", category: "fruit" }, { id: "ok", name: "苹果", category: "fruit" }];
  h.definition.data.category = "全部";
  assert.doesNotThrow(() => h.definition.filter());
  assert.deepEqual(h.definition.data.products.map(item => item.id), ["ok"]);
});

test("home normalizes missing nested API fields before template rendering", async () => {
  let definition; let resolve;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/home/index.js"), "utf8"), { Page: value => { definition = value; }, wx: { getStorageSync: () => null }, require: () => ({ request: () => new Promise(r => { resolve = r; }) }) });
  definition.setData = (value, cb) => { Object.assign(definition.data, value); cb?.(); };
  const load = definition.load(); resolve({ banners: null, pickupSite: null, recommendProducts: [null, { id: "bad" }] }); await load;
  assert.equal(definition.data.home.banners[0].title, "时令鲜果季");
  assert.deepEqual(definition.data.home.recommendProducts, []);
});
