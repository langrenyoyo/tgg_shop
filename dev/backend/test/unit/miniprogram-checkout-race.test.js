const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(name) {
  let page, owner = "alice";
  const pending = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../../../wechat-miniprogram/pages/${name}/index.js`), "utf8"), {
    Page: value => { page = value; },
    wx: { getStorageSync: () => ({ id: owner }) },
    require: name => name.endsWith("api") ? { request: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) } : {
      checkoutIdempotencyKey: () => "key", readCheckout: () => [{ productId: "apple", quantity: 1 }]
    }
  });
  page.setData = (value, cb) => { Object.assign(page.data, value); cb?.(); };
  page.ownerId = "alice"; page.idempotencyKey = "key";
  return { page, pending, owner: value => { owner = value; } };
}

function resolveCheckout(rows, points) {
  const data = { "/api/me": { id: "alice", points }, "/api/config": { deliveryEnabled: true }, "/api/pickup-sites": [], "/api/products": [{ id: "apple", supportsPoints: true, pointsPrice: 10 }] };
  rows.forEach(row => row.resolve(data[row.url]));
}

test("checkout newer load wins and unloaded requests cannot restore state", async () => {
  const { page, pending } = harness("checkout");
  const first = page.load(); const second = page.load();
  resolveCheckout(pending.slice(4), 200); await second;
  resolveCheckout(pending.slice(0, 4), 100); await first;
  assert.equal(page.data.user.points, 200);
  const last = page.load(); page.onUnload();
  resolveCheckout(pending.slice(8), 300); await last;
  assert.equal(page.data.user, null);
});

test("checkout account switch drops old response and clears frozen address on reentry", async () => {
  const h = harness("checkout");
  h.page.data.pending = { deliveryAddress: "private" };
  const load = h.page.load(); h.owner("bob");
  resolveCheckout(h.pending, 100); await load;
  assert.equal(h.page.data.user, null);
  await h.page.load();
  assert.equal(h.page.data.pending, null);
  assert.match(h.page.data.error, /账号已变更/);
});

test("orders account switch clears cached rows and discards previous account response", async () => {
  const h = harness("orders");
  h.page.data.orders = [{ id: "private" }];
  const old = h.page.load();
  assert.equal(h.page.data.orders.length, 0);
  h.owner("bob"); const current = h.page.load(true);
  assert.match(h.pending[1].url, /page=1&/);
  h.pending[1].resolve([{ id: "bob-order", status: "refunded", fulfillmentStatus: "pending_ship" }]); await current;
  h.pending[0].resolve([{ id: "alice-order" }]); await old;
  assert.equal(h.page.data.orders[0].id, "bob-order");
  assert.equal(h.page.data.orders[0].fulfillmentText, "");
});
