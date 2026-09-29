process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const station = require("../../src/services/station-service");
const { createOrder } = require("../../src/domain/rules");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const { handleStationRoutes } = require("../../src/routes/station-routes");
const auth = require("../../src/services/auth-service");
const makeOrder = state => createOrder(state, "u_1001", { paymentMode: "pure_points", items: [{ productId: "p_banana", quantity: 1 }] }).order;
const packages = () => [{ shelfCode: "A-02-03", storageType: "ambient", bagCount: 2 }, { shelfCode: "C-01", storageType: "chilled", bagCount: 1 }, { shelfCode: "F-03", storageType: "frozen", bagCount: 1 }];
function setup() {
  const state = createSeed(), account = state.stationAccounts[0], order = makeOrder(state);
  assert.equal(station.receive(state, account, order.id, { packages: packages() }).ok, true);
  return { state, account, order };
}
const confirm = (order, found) => ({ pickupCode: order.pickupCode, pickupVersion: found.pickupVersion, confirmedPackageIds: found.order.packages.map(item => item.id), idempotencyKey: "handover-1" });

test("pickup lookup displays all stored locations and bags without completing or changing any state", () => {
  const { state, account, order } = setup();
  const before = JSON.stringify(state);
  const found = station.lookupPickup(state, account, { pickupCode: order.pickupCode });
  assert.equal(found.ok, true);
  assert.equal(found.order.bagCount, 4);
  assert.equal(found.order.itemCount, 1);
  assert.deepEqual(found.order.packages.map(row => row.shelfCode), ["A-02-03", "C-01", "F-03"]);
  assert.deepEqual(found.order.packages.map(row => row.storageLabel), ["常温", "冷藏", "冷冻"]);
  assert.equal(found.order.pickupCode, undefined);
  assert.equal(JSON.stringify(state), before);
  assert.equal(station.listOrders(state, account, { keyword: "F-03" })[0].id, order.id);
  saveSQLiteState(state, ":memory:");
  const restored = loadSQLiteState(":memory:");
  assert.deepEqual(station.lookupPickup(restored, account, { pickupCode: order.pickupCode }), found);
});

test("confirmed pickup requires every package, completes once and frees all locations", () => {
  const { state, account, order } = setup();
  const found = station.lookupPickup(state, account, { pickupCode: order.pickupCode }), input = confirm(order, found);
  assert.equal(station.pickup(state, account, order.id, { pickupCode: order.pickupCode }).status, 409);
  assert.equal(station.pickup(state, account, order.id, { ...input, confirmedPackageIds: ["package-1"] }).status, 400);
  assert.equal(station.pickup(state, account, order.id, { ...input, confirmedPackageIds: ["package-1", "package-1", "package-1"] }).status, 400);
  const next = makeOrder(state);
  assert.equal(station.receive(state, account, next.id, { packages: [{ shelfCode: "C-01", storageType: "chilled", bagCount: 1 }] }).status, 409);
  assert.equal(station.pickup(state, account, order.id, input).ok, true);
  assert.equal(order.status, "completed");
  assert.equal(station.pickup(state, account, order.id, input).ok, true);
  assert.equal(state.stationOperationLogs.filter(row => row.action === "pickup_verify" && row.result === "success").length, 1);
  assert.equal(station.receive(state, account, next.id, { packages: packages() }).ok, true);
  assert.equal(station.lookupPickup(state, account, { orderId: order.id, pickupCode: order.pickupCode }).status, 404);
});

test("lookup rejects code collisions, wrong site, wrong code, missing permission and unreceived orders", () => {
  const { state, account, order } = setup();
  const duplicate = makeOrder(state); duplicate.pickupCode = order.pickupCode;
  assert.equal(station.receive(state, account, duplicate.id).ok, true);
  assert.equal(station.lookupPickup(state, account, { pickupCode: order.pickupCode }).requiresOrderId, true);
  assert.equal(station.lookupPickup(state, account, { orderId: order.id, pickupCode: order.pickupCode }).order.id, order.id);
  assert.equal(station.lookupPickup(state, { ...account, siteIds: ["other"] }, { pickupCode: order.pickupCode }).status, 404);
  assert.equal(station.lookupPickup(state, { ...account, permissions: ["station:receive"] }, { pickupCode: order.pickupCode }).status, 403);
  assert.equal(station.lookupPickup(state, account, { pickupCode: "wrong" }).status, 404);
  const unreceived = makeOrder(state);
  assert.equal(station.lookupPickup(state, account, { orderId: unreceived.id, pickupCode: unreceived.pickupCode }).status, 404);
});

test("refunds, exceptions and changed storage after lookup cannot be confirmed from stale results", () => {
  for (const change of ["refund", "exception", "storage"]) {
    const { state, account, order } = setup();
    const found = station.lookupPickup(state, account, { pickupCode: order.pickupCode });
    if (change === "refund") order.status = "refunding";
    if (change === "exception") station.createException(state, account, order.id, { type: "damaged", remark: "待核查" });
    if (change === "storage") state.stationOrders.find(row => row.orderId === order.id).packages[1].shelfCode = "C-99";
    assert.equal(station.pickup(state, account, order.id, confirm(order, found)).ok, false);
    assert.notEqual(order.status, "completed");
  }
});

test("invalid package rows do not partially receive an order or reserve storage", () => {
  const state = createSeed(), account = state.stationAccounts[0], order = makeOrder(state);
  for (const bad of [[], [null], [{ shelfCode: "C", storageType: "chilled", bagCount: 0 }], [{ shelfCode: "", storageType: "frozen", bagCount: 1 }], [{ shelfCode: "C", storageType: "invalid", bagCount: 1 }], [packages()[0], packages()[0]]]) {
    const before = JSON.stringify(state);
    assert.equal(station.receive(state, account, order.id, { packages: bad }).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
});

test("pickup lookup endpoint authenticates and never mutates order state", async () => {
  const { state, account, order } = setup();
  let status, response;
  const ctx = { state, req: { method: "POST", headers: {} }, url: new URL("http://localhost/api/station/pickup-lookup"),
    readBody: () => { throw new Error("unauthorized read"); }, send: (_, code, data) => { status = code; response = data; } };
  await handleStationRoutes(ctx); assert.equal(status, 401);
  const login = auth.stationLogin(state, { username: account.username, password: "123456" });
  ctx.req.headers.authorization = `Bearer ${login.token}`;
  ctx.readBody = async () => ({ pickupCode: order.pickupCode });
  await handleStationRoutes(ctx);
  assert.equal(status, 200); assert.equal(response.order.id, order.id); assert.equal(order.status, "paid");
});
