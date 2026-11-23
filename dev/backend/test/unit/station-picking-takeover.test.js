process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const station = require("../../src/services/station-service");

function setup(legacy = false) {
  const state = createSeed(), owner = state.stationAccounts[0], order = state.orders[0];
  const worker = { ...owner, id: "other-worker", name: "接手工作人员" };
  state.stationAccounts.push(worker);
  assert.equal(station.claim(state, owner, order.id).ok, true);
  const record = state.stationOrders.find(row => row.orderId === order.id);
  const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  record.pickingClaimedAt = old;
  state.stationOperationLogs.find(row => row.action === "picking.claim").createdAt = old;
  if (legacy) delete record.pickingClaimedAt;
  return { state, owner, worker, order, record };
}
function intent(h) {
  const conflict = station.claim(h.state, h.worker, h.order.id);
  assert.equal(conflict.status, 409); assert.equal(conflict.takeoverAllowed, true);
  return { takeover: true, takeoverVersion: conflict.takeoverVersion };
}

test("historical abandoned picking can be explicitly taken over, then received and handed over once", () => {
  const h = setup(true), { state, owner, worker, order, record } = h;
  const input = intent(h);
  assert.equal(record.pickerId, owner.id);
  const before = JSON.stringify(state);
  assert.equal(station.claim(state, worker, order.id, { takeover: true }).status, 409);
  assert.equal(JSON.stringify(state), before);
  const result = station.claim(state, worker, order.id, input);
  assert.equal(result.ok, true); assert.equal(result.order.pickerName, worker.name);
  assert.equal(order.status, "paid"); assert.equal(order.fulfillmentStatus, "pending_pickup");
  assert.equal(station.receive(state, owner, order.id).status, 409);
  const audit = state.stationOperationLogs.find(row => row.action === "picking.takeover");
  assert.equal(audit.previousPickerId, owner.id); assert.equal(audit.operatorId, worker.id);
  assert.equal(station.receive(state, worker, order.id, { packages: [{ shelfCode: "", storageType: "ambient", bagCount: 1 }], receivedItems: order.items.map(row => ({ productId: row.productId, quantity: row.quantity })) }).ok, true);
  const found = station.lookupPickup(state, worker, { orderId: order.id, pickupCode: order.pickupCode });
  assert.equal(found.ok, true);
  assert.equal(station.pickup(state, worker, order.id, { pickupCode: order.pickupCode, pickupVersion: found.pickupVersion, confirmedPackageIds: found.order.packages.map(row => row.id), idempotencyKey: "handover" }).ok, true);
  assert.equal(order.status, "completed");
});

test("active, unknown-age and refreshed claims cannot be taken with an expired preview", () => {
  for (const change of ["active", "unknown", "renewed", "another-owner"]) {
    const h = setup(), input = intent(h);
    if (change === "active" || change === "renewed") station.claim(h.state, h.owner, h.order.id);
    if (change === "unknown") { delete h.record.pickingClaimedAt; h.state.stationOperationLogs = []; }
    if (change === "another-owner") h.record.pickerId = "third-worker";
    const before = JSON.stringify(h.state);
    assert.equal(station.claim(h.state, h.worker, h.order.id, input).status, 409);
    assert.equal(JSON.stringify(h.state), before);
  }
});

test("takeover enforces site, permission, payment, ready-state and picking switch; cannot release someone else's task", () => {
  for (const change of ["site", "permission", "refunding", "ready", "disabled", "release"]) {
    const h = setup(), input = intent(h);
    if (change === "site") h.worker.siteIds = ["other-site"];
    if (change === "permission") h.worker.permissions = ["station:pickup"];
    if (change === "refunding") h.order.status = "refunding";
    if (change === "ready") h.record.stationStatus = "ready";
    if (change === "disabled") h.state.config.stationPickingEnabled = false;
    if (change === "release") input.release = true;
    const before = JSON.stringify(h.state);
    assert.equal(station.claim(h.state, h.worker, h.order.id, input).ok, false);
    assert.equal(JSON.stringify(h.state), before);
  }
});
