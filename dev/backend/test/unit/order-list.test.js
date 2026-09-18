process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { listUserOrders } = require("../../src/services/order-service");
const { handleOrderRoutes } = require("../../src/routes/order-routes");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("order list filters ownership and fulfillment before sorted pagination, keeping legacy array", () => {
  const state = { orders: Array.from({ length: 45 }, (_, i) => ({ id: String(i), userId: "alice", status: i < 22 ? "paid" : "refunding", fulfillmentStatus: "shipping", createdAt: new Date(1700000000000 + i * 1000).toISOString() })) };
  state.orders.push({ id: "foreign", userId: "bob", status: "paid", fulfillmentStatus: "shipping" });
  const query = { status: "paid", fulfillmentStatus: "shipping", page: "1", count: "20" };
  const first = listUserOrders(state, "alice", query);
  const second = listUserOrders(state, "alice", { ...query, page: "2" });
  assert.equal(first.length, 20);
  assert.equal(first[0].id, "21");
  assert.equal(second.length, 2);
  assert.equal(new Set(first.concat(second).map(item => item.id)).size, 22);
  assert.equal(listUserOrders(state, "alice").length, 45);
});

test("invalid order filters return 400", async () => {
  for (const query of ["page=0", "count=101", "page=1.5", "status=bad", "fulfillmentStatus=bad"]) {
    let status;
    await handleOrderRoutes({ req: { method: "GET" }, url: new URL("https://example.com/api/orders?" + query), state: { orders: [] }, user: { id: "alice" }, send: (res, code) => { status = code; } });
    assert.equal(status, 400);
  }
});

test("order page ignores stale filter responses and permits retry after load failure", async () => {
  let page;
  const requests = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/orders/index.js"), "utf8"), {
    Page: value => { page = value; },
    wx: { getStorageSync: () => ({ id: "alice" }) },
    require: () => ({ request: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) })
  });
  page.setData = (data, callback) => { Object.assign(page.data, data); callback?.(); };
  const stale = page.load();
  page.filter({ detail: { value: "1" } });
  requests[1].resolve([{ id: "pending", status: "pending_payment" }]);
  await new Promise(setImmediate);
  requests[0].resolve([{ id: "stale", status: "paid" }]);
  await stale;
  assert.equal(page.data.orders[0].id, "pending");
  assert.match(requests[1].url, /status=pending_payment/);
  const failure = page.load();
  requests[2].reject(new Error("network unavailable"));
  await failure;
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, "network unavailable");
  const retry = page.load();
  requests[3].resolve([]);
  await retry;
  assert.equal(page.data.error, "");
  assert.equal(page.data.orders.length, 0);
});
