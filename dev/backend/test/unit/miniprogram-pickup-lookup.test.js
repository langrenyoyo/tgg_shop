process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const station = require("../../src/services/station-service");

function harness() {
  const state = createSeed(), account = state.stationAccounts[0], order = state.orders[0];
  station.receive(state, account, order.id, { packages: [{ shelfCode: "A-1", storageType: "ambient", bagCount: 2 }, { shelfCode: "C-1", storageType: "chilled", bagCount: 1 }] });
  let page, loseResponse = false;
  const calls = [], messages = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/station/index.js"), "utf8"), {
    Page: value => { page = value; }, wx: { showToast: value => messages.push(value.title), scanCode: options => options.success({ result: order.pickupCode }) },
    require: () => ({ request: async (url, options = {}) => {
      calls.push({ url, data: JSON.parse(JSON.stringify(options.data || {})) });
      if (url === "/api/station/me") return { station: station.publicStation(account), sites: state.pickupSites };
      if (url === "/api/station/dashboard") return station.dashboard(state, account);
      if (url === "/api/station/orders") return station.listOrders(state, account);
      let result;
      if (url === "/api/station/pickup-lookup") result = station.lookupPickup(state, account, options.data);
      else if (url.endsWith("/pickup-verify")) {
        result = station.pickup(state, account, order.id, options.data);
        if (loseResponse) { loseResponse = false; throw new Error("网络连接中断"); }
      } else throw new Error(`Unexpected URL ${url}`);
      if (!result.ok) throw Object.assign(new Error(result.error), { statusCode: result.status });
      return result;
    } })
  });
  page.setData = (value, cb) => { Object.assign(page.data, value); cb?.(); };
  return { page, state, order, calls, messages, loseResponse: () => { loseResponse = true; } };
}

test("mini scan displays all locations without handing over; incomplete package check blocks confirmation", async () => {
  const h = harness(); await h.page.load();
  await h.page.scan({ currentTarget: { dataset: { target: "pickupCode" } } });
  assert.equal(h.page.data.pickupPreview.order.bagCount, 3);
  assert.equal(h.order.status, "paid");
  assert.equal(h.calls.filter(call => call.url.endsWith("/pickup-verify")).length, 0);
  h.page.pickupCheck({ detail: { value: ["package-1"] } });
  await h.page.confirmPickup();
  assert.equal(h.order.status, "paid");
  h.page.pickupCheck({ detail: { value: ["package-1", "package-2"] } });
  await Promise.all([h.page.confirmPickup(), h.page.confirmPickup()]);
  assert.equal(h.order.status, "completed");
  assert.equal(h.calls.filter(call => call.url.endsWith("/pickup-verify")).length, 1);
  assert.equal(h.page.data.pickupPreview, null);
});

test("mini cancelled lookup keeps order pending and ambiguous handover retries exact original intent", async () => {
  const h = harness(); await h.page.load();
  await h.page.pickupByCode("", h.order.pickupCode);
  h.page.cancelPickup();
  assert.equal(h.order.status, "paid");
  assert.equal(h.page.data.pickupPreview, null);
  await h.page.pickupByCode("", h.order.pickupCode);
  h.page.pickupCheck({ detail: { value: ["package-1", "package-2"] } });
  h.loseResponse();
  await h.page.confirmPickup();
  assert.equal(h.page.data.pendingPickup, true);
  h.page.cancelPickup();
  assert.ok(h.page.data.pickupPreview);
  h.page.pickupCheck({ detail: { value: [] } });
  await h.page.retryPickup();
  const writes = h.calls.filter(call => call.url.endsWith("/pickup-verify"));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].data, writes[1].data);
  assert.equal(h.state.stationOperationLogs.filter(row => row.action === "pickup_verify").length, 1);
  assert.equal(h.page.data.pendingPickup, false);
});

test("mini stale pickup preview is cleared after server rejects changed storage", async () => {
  const h = harness(); await h.page.load();
  await h.page.pickupByCode("", h.order.pickupCode);
  h.page.pickupCheck({ detail: { value: ["package-1", "package-2"] } });
  h.state.stationOrders.find(row => row.orderId === h.order.id).packages[0].shelfCode = "A-9";
  await h.page.confirmPickup();
  assert.equal(h.order.status, "paid");
  assert.equal(h.page.data.pickupPreview, null);
  assert.equal(h.page.pickupAttempt, null);
  assert.match(h.messages.at(-1), /重新查找/);
});
