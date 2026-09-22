process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { resolveStation } = require("../../src/domain/auth");
const authService = require("../../src/services/auth-service");
const stationService = require("../../src/services/station-service");

test("station login creates an isolated station session", () => {
  const state = createSeed();
  const login = authService.stationLogin(state, { username: "station001", password: "123456" });
  assert.equal(login.ok, true);
  assert.equal(login.station.siteIds[0], "site_001");
  const resolved = resolveStation({ headers: { authorization: `Bearer ${login.token}` } }, state);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.account.id, "station_001");
});

test("station can receive and idempotently retry an authorized pickup order", () => {
  const state = createSeed();
  const account = state.stationAccounts[0];
  const order = state.orders[0];
  const received = stationService.receive(state, account, order.id, { idempotencyKey: "receive-1", shelfCode: "A-01", condition: "normal" });
  assert.equal(received.ok, true);
  assert.equal(received.order.stationStatus, "ready");
  const retry = stationService.receive(state, account, order.id, { idempotencyKey: "receive-1", shelfCode: "B-99", condition: "damaged" });
  assert.equal(retry.ok, true);
  assert.equal(retry.order.shelfCode, "A-01");
  assert.equal(state.stationOperationLogs.filter((item) => item.idempotencyKey === "receive-1").length, 1);
});

test("station rejects a second receive with a new key and validates site and quantities", () => {
  const state = createSeed();
  const account = state.stationAccounts[0];
  const order = state.orders[0];
  const badSite = stationService.receive(state, account, order.id, { idempotencyKey: "receive-bad-site", siteId: "other-site" });
  assert.equal(badSite.ok, false);
  assert.match(badSite.error, /站点/);
  const badQuantity = stationService.receive(state, account, order.id, { idempotencyKey: "receive-bad-qty", siteId: "site_001", receivedItems: [{ productId: order.items[0].productId, quantity: 99 }] });
  assert.equal(badQuantity.ok, false);
  const first = stationService.receive(state, account, order.id, { idempotencyKey: "receive-first", siteId: "site_001", shelfCode: "A-01" });
  assert.equal(first.ok, true);
  const duplicate = stationService.receive(state, account, order.id, { idempotencyKey: "receive-second", siteId: "site_001", shelfCode: "B-99", condition: "damaged" });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /重复|已经/);
  assert.equal(state.stationOrders[0].shelfCode, "A-01");
  assert.equal(order.stationStatus, "ready");
});

test("station status is visible on the shared order after receive and pickup", () => {
  const state = createSeed();
  const account = state.stationAccounts[0];
  const order = state.orders[0];
  stationService.receive(state, account, order.id, { idempotencyKey: "sync-receive", siteId: "site_001" });
  assert.equal(order.stationStatus, "ready");
  assert.equal(stationService.listOrders(state, account)[0].stationStatus, "ready");
  stationService.pickup(state, account, order.id, { idempotencyKey: "sync-pickup", siteId: "site_001", pickupCode: order.pickupCode });
  assert.equal(order.stationStatus, "picked_up");
  assert.equal(order.fulfillmentStatus, "picked_up");
  assert.equal(order.status, "completed");
});

test("station pickup rejects wrong codes and completes only after receiving", () => {
  const state = createSeed();
  const account = state.stationAccounts[0];
  const order = state.orders[0];
  const before = JSON.stringify(order);
  const beforeReceive = stationService.pickup(state, account, order.id, { idempotencyKey: "pickup-before", pickupCode: order.pickupCode });
  assert.equal(beforeReceive.ok, false);
  assert.equal(JSON.stringify(order), before);

  stationService.receive(state, account, order.id, { idempotencyKey: "receive-2", condition: "normal" });
  const wrong = stationService.pickup(state, account, order.id, { idempotencyKey: "pickup-wrong", pickupCode: "000000" });
  assert.equal(wrong.ok, false);
  const picked = stationService.pickup(state, account, order.id, { idempotencyKey: "pickup-2", pickupCode: order.pickupCode });
  assert.equal(picked.ok, true);
  assert.equal(picked.order.stationStatus, "picked_up");
  assert.equal(order.status, "completed");
});

test("station cannot access an order assigned to another site", () => {
  const state = createSeed();
  const account = state.stationAccounts[0];
  const order = { ...state.orders[0], id: "other-site-order", pickupSiteId: "other-site" };
  state.orders.push(order);
  assert.equal(stationService.receive(state, account, order.id, { condition: "normal" }).status, 404);
  assert.equal(stationService.listOrders(state, account).some((item) => item.id === order.id), false);
});
