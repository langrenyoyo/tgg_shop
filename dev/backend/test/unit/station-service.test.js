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
