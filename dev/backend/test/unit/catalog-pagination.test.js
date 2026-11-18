const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../../src/services/catalog-service");
const { handleCatalogRoutes } = require("../../src/routes/catalog-routes");

const state = { products: Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, name: `苹果${i}`, category: i < 20 ? "水果" : "零食", status: "on", purePointsOnly: i % 2 === 0 })) };

test("catalog pages contain ten products, preserve order and report the last page", () => {
  const pages = [1, 2, 3].map(page => catalog.listProductPage(state, { page }));
  assert.deepEqual(pages.map(page => page.items.length), [10, 10, 5]);
  assert.deepEqual(pages.map(page => page.hasMore), [true, true, false]);
  assert.deepEqual(pages.flatMap(page => page.items), state.products);
  assert.equal(pages[0].total, 25);
  assert.deepEqual(pages[0].categories, ["买商品送会员", "纯积分兑换", "水果", "零食"]);
  assert.equal(catalog.listProductPage(state, { page: 4 }).items.length, 0);
});

test("category, pure points and keyword filters run before pagination and exclude unpublished goods", () => {
  const source = { products: [...state.products, { id: "off", name: "苹果", category: "蔬菜", status: "off" }, { id: "blank", name: " ", status: "on" }] };
  const fruit = catalog.listProductPage(source, { category: "水果", page: 2 });
  assert.equal(fruit.total, 20);
  assert.equal(fruit.items[0].id, "p10");
  assert.equal(fruit.hasMore, false);
  assert.equal(fruit.categories.includes("蔬菜"), false);
  const points = catalog.listProductPage(source, { category: "纯积分兑换", page: 2 });
  assert.equal(points.total, 13);
  assert.ok(points.items.every(item => item.purePointsOnly));
  const search = catalog.listProductPage(source, { category: "水果", search: " 苹果1 ", page: 1 });
  assert.equal(search.total, 11);
  assert.equal(search.hasMore, true);
  assert.equal(catalog.listProductPage(source, { category: "unknown" }).total, 0);
});

test("product route keeps legacy arrays and validates paginated requests", async () => {
  async function get(query) {
    let response;
    await handleCatalogRoutes({ req: { method: "GET" }, url: new URL("http://localhost/api/products" + query), state, send: (_, status, body) => { response = { status, body }; } });
    return response;
  }
  assert.deepEqual((await get("")).body, state.products);
  assert.equal((await get("?category=" + encodeURIComponent("零食"))).body.length, 5);
  assert.equal((await get("?page=2&pageSize=10")).body.items[0].id, "p10");
  assert.equal((await get("?page=1&search=" + encodeURIComponent("苹果24"))).body.total, 1);
  for (const query of ["?page=0", "?page=-1", "?page=1.5", "?page=x", "?page=1&pageSize=101", "?page=1&pageSize=0", "?page=9007199254740991"]) {
    assert.equal((await get(query)).status, 400, query);
  }
});
