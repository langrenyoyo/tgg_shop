process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const station = require("../../src/services/station-service");

function setup() {
  const state = createSeed(), owner = state.stationAccounts[0], order = state.orders[0];
  const worker = { ...owner, id: "new-worker", name: "新工作人员" }; state.stationAccounts.push(worker);
  station.claim(state, owner, order.id);
  delete state.stationOrders.find(row => row.orderId === order.id).pickingClaimedAt;
  state.stationOperationLogs[0].createdAt = new Date(Date.now() - 31 * 60000).toISOString();
  let page;
  const modals = [], messages = [], calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/station/index.js"), "utf8"), {
    Page: value => { page = value; },
    wx: { showModal: value => modals.push(value), showToast: value => messages.push(value.title) },
    require: () => ({ request: async (url, options = {}) => {
      calls.push({ url, data: options.data });
      if (url === "/api/station/me") return { station: station.publicStation(worker), sites: state.pickupSites };
      if (url === "/api/station/dashboard") return station.dashboard(state, worker);
      if (url === "/api/station/orders") return station.listOrders(state, worker);
      const result = url.endsWith("/picking") ? station.claim(state, worker, order.id, options.data) : station.receive(state, worker, order.id, options.data);
      if (!result.ok) throw Object.assign(new Error(result.error), { statusCode: result.status, code: result.code, takeoverAllowed: result.takeoverAllowed, takeoverVersion: result.takeoverVersion });
      return result;
    } })
  });
  page.setData = (value, cb) => { Object.assign(page.data, value); cb?.(); };
  return { page, state, worker, owner, order, modals, messages, calls };
}
const tick = () => new Promise(setImmediate);

test("station confirms old picking takeover then enters quantity checking and receives before pickup", async () => {
  const h = setup(); await h.page.load();
  assert.equal(h.page.data.orders[0].stationStatusText, "拣货中");
  assert.equal(h.page.data.orders[0].receiveLabel, "查看并接手收货");
  const action = h.page.receiveById(h.order.id); await tick();
  assert.equal(h.modals.length, 1); assert.equal(h.page.data.busy, true);
  await h.page.receiveById(h.order.id); assert.equal(h.modals.length, 1);
  h.modals[0].success({ confirm: true }); await action;
  assert.equal(h.page.data.current.id, h.order.id);
  await h.page.confirmReceive(); assert.match(h.messages.at(-1), /实收数量/);
  assert.equal(h.order.stationStatus, "picking");
  h.page.quantity({ currentTarget: { dataset: { index: 0 } }, detail: { value: String(h.order.items[0].quantity) } });
  await h.page.confirmReceive();
  assert.equal(h.order.stationStatus, "ready"); assert.equal(h.order.status, "paid");
  assert.equal(h.page.data.current, null); assert.equal(h.page.data.counts.readyPickup, 1);
});

test("cancelled or stale takeover confirmations cannot claim or receive goods", async () => {
  for (const change of ["cancel", "unload", "renewed", "view-change"]) {
    const h = setup(); await h.page.load();
    const action = h.page.receiveById(h.order.id); await tick();
    if (change === "unload") h.page.onUnload();
    if (change === "renewed") station.claim(h.state, h.owner, h.order.id);
    if (change === "view-change") await h.page.load();
    h.modals[0].success({ confirm: change !== "cancel" }); await action;
    assert.equal(h.page.data.current, null);
    assert.equal(h.state.stationOrders[0].pickerId, h.owner.id);
    assert.equal(h.order.status, "paid");
    assert.equal(h.page.data.busy, false);
  }
});
