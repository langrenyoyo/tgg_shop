// Audit regressions: assertions describe expected behavior, not the existing defects.
// Run separately: node --no-warnings --test test/audit/config-closure.test.js
process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const admin = require("../../src/services/admin-service");
const station = require("../../src/services/station-service");
const { createOrder } = require("../../src/domain/rules");
const refunds = require("../../src/domain/refund-rules");
const actor = { role: { id: "super_admin", permissions: ["*"] } };
const read = file => fs.readFileSync(path.resolve(__dirname, "../../../..", file), "utf8");

test("control: configured barcode receive and station pickup complete once", () => {
  const state = createSeed(), order = state.orders[0], account = state.stationAccounts[0];
  admin.updateConfig(state, { stationScanRequired: true, reason: "audit" }, actor);
  const items = order.items.map(item => {
    const product = state.products.find(p => p.id === item.productId);
    product.barcode = `audit-${product.id}`;
    return { ...item, barcode: product.barcode };
  });
  assert.equal(station.receive(state, account, order.id, { receivedItems: items, shelfCode: "S-01", idempotencyKey: "audit-receive" }).ok, true);
  const input = { pickupCode: order.pickupCode, idempotencyKey: "audit-pickup" };
  assert.equal(station.pickup(state, account, order.id, input).ok, true);
  assert.equal(station.pickup(state, account, order.id, input).ok, true);
  assert.equal(order.status, "completed");
});

test("native station must support receiving after admin enables mandatory barcode checking", async () => {
  const state = createSeed(), order = state.orders[0], account = state.stationAccounts[0];
  admin.updateConfig(state, { stationScanRequired: true, reason: "audit" }, actor);
  order.items.forEach(item => { state.products.find(p => p.id === item.productId).barcode = `audit-${item.productId}`; });
  let page;
  const messages = [];
  const request = async (url, options) => {
    if (url === "/api/station/me") return { station: account, sites: state.pickupSites };
    if (url === "/api/station/dashboard") return station.dashboard(state, account);
    if (url === "/api/station/orders") return station.listOrders(state, account);
    if (url.endsWith("/picking")) return station.claim(state, account, order.id, options.data);
    if (url.endsWith("/receive")) {
      const result = station.receive(state, account, order.id, options.data);
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  vm.runInNewContext(read("wechat-miniprogram/pages/station/index.js"), {
    Page: value => { page = value; }, require: () => ({ request }),
    wx: { showToast: value => messages.push(value.title), scanCode: options => options.success({ result: `audit-${order.items[0].productId}` }) }
  });
  page.setData = (data, cb) => { Object.assign(page.data, data); cb?.(); };
  await page.load();
  await page.receiveById(order.id);
  assert.equal(order.stationStatus, "picking");
  await page.confirmReceive();
  assert.equal(order.stationStatus, "picking", "blank quantities and missing scans must not receive the order");
  for (let index = 0; index < page.data.checkItems.length; index++) {
    page.quantity({ currentTarget: { dataset: { index } }, detail: { value: String(page.data.checkItems[index].quantity) } });
    await page.scanProduct({ currentTarget: { dataset: { index } } });
  }
  await page.confirmReceive();
  assert.equal(order.stationStatus, "ready", messages.join("; "));
});

test("native checkout must expose configured delivery slots to the user", () => {
  const view = read("wechat-miniprogram/pages/checkout/index.wxml");
  assert.match(view, /deliveryTimeSlots|deliveryTimeSlot/, "Native checkout has no delivery time selection");
});

test("receive must reject duplicate product lines that omit another product", () => {
  const state = createSeed(), account = state.stationAccounts[0];
  const created = createOrder(state, "u_1001", { paymentMode: "pure_points", items: [
    { productId: "p_banana", quantity: 1 }, { productId: "p_bokchoy", quantity: 1 }
  ] });
  assert.equal(created.ok, true);
  const result = station.receive(state, account, created.order.id, {
    receivedItems: [{ productId: "p_banana", quantity: 1 }, { productId: "p_banana", quantity: 1 }]
  });
  assert.equal(result.ok, false, "Missing bokchoy was accepted as fully received");
});

test("admin pickup must synchronize the station record and ready count", () => {
  const state = createSeed(), order = state.orders[0], account = state.stationAccounts[0];
  assert.equal(station.receive(state, account, order.id, { shelfCode: "S-01" }).ok, true);
  assert.equal(admin.verifyPickupOrder(state, order.id, order.pickupCode, actor, "audit").ok, true);
  assert.equal(station.listOrders(state, account).find(row => row.id === order.id).stationStatus, "picked_up");
  assert.equal(station.dashboard(state, account).counts.readyPickup, 0);
});

test("refunded received orders must leave the station ready-pickup count", () => {
  const state = createSeed(), account = state.stationAccounts[0];
  const created = createOrder(state, "u_1001", { paymentMode: "pure_points", items: [{ productId: "p_banana", quantity: 1 }] });
  assert.equal(created.ok, true);
  const order = created.order;
  assert.equal(station.receive(state, account, order.id, { shelfCode: "S-02" }).ok, true);
  const request = refunds.createRefundRequest(state, order.userId, order.id, "audit");
  assert.equal(refunds.approveRefund(state, request.refundOrder.id).ok, true);
  assert.equal(order.status, "refunded");
  assert.equal(station.dashboard(state, account).counts.readyPickup, 0, "Refunded order still counted as ready for collection");
});

test("station shortage must be visible in the admin exception or ticket queue", () => {
  const state = createSeed(), order = state.orders[0], account = state.stationAccounts[0];
  assert.equal(station.createException(state, account, order.id, { type: "shortage", remark: "audit shortage" }).ok, true);
  const queues = [...admin.listExceptions(state), ...admin.listTickets(state)];
  assert.ok(queues.some(row => row.orderId === order.id || row.bizNo === order.id || row.linkedId === order.id),
    "Station exception has no linked admin work item");
});

test("empty delivery slots must not allow arbitrary client supplied time slots", () => {
  const state = createSeed();
  admin.updateConfig(state, { deliveryTimeSlots: ["invalid"], reason: "audit" }, actor);
  const result = createOrder(state, "u_1001", {
    paymentMode: "pure_points", fulfillmentType: "delivery", deliveryAddress: "audit address",
    deliveryTimeSlot: "arbitrary-slot", items: [{ productId: "p_banana", quantity: 1 }]
  });
  assert.equal(result.ok, false, "Invalid configuration cleared slots and disabled order slot validation");
});

function settingsHtml(config) {
  const source = read("dev/frontend/admin/js/render.js");
  const fn = source.slice(source.indexOf("function settings(state)"), source.indexOf("function refundApprovalRows"));
  return vm.runInNewContext(`${fn}; settings({ config })`, { config, escapeHtml: String, escapeAttr: String });
}

test("disabled monthly reward must render an unchecked checkbox", () => {
  const html = settingsHtml({ monthlyPointRewardEnabled: false });
  const input = html.match(/<input[^>]*name="monthlyPointRewardEnabled"[^>]*>/)?.[0];
  assert.ok(input);
  assert.doesNotMatch(input, /\bchecked\b/, "Saving another points setting would re-enable disabled monthly rewards");
});

test("points settings form must submit the membership point-to-cash rate", () => {
  const source = read("dev/frontend/admin/js/app.js");
  const fn = source.slice(source.indexOf("function buildConfigPayload("), source.indexOf("function parseListField("));
  const payload = vm.runInNewContext(`${fn}; buildConfigPayload('points', fields)`, {
    fields: { get: key => key === "membershipPointCashRate" ? "0.025" : "0" }
  });
  assert.equal(payload.membershipPointCashRate, 0.025, "Visible form field is omitted from the save payload");
});
