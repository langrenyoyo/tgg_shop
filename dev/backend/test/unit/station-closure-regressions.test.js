process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const station = require("../../src/services/station-service");
const admin = require("../../src/services/admin-service");
const refunds = require("../../src/domain/refund-rules");
const returns = require("../../src/services/refund-return-service");
const { createOrder } = require("../../src/domain/rules");
const actor = { role: { id: "super_admin", permissions: ["*"] } };
const newOrder = state => createOrder(state, "u_1001", { paymentMode: "pure_points", items: [{ productId: "p_banana", quantity: 1 }] }).order;

test("picking ownership prevents double work and releases even when feature disabled", () => {
  const state = createSeed(), account = state.stationAccounts[0], order = newOrder(state), other = { ...account, id: "worker2" };
  assert.equal(station.claim(state, account, order.id).ok, true);
  assert.equal(station.claim(state, other, order.id).status, 409);
  assert.equal(station.receive(state, other, order.id).status, 409);
  assert.equal(admin.verifyPickupOrder(state, order.id, order.pickupCode, actor, "test").ok, false);
  state.config.stationPickingEnabled = false;
  assert.equal(station.claim(state, account, order.id, { release: true }).ok, true);
  state.config.stationPickingEnabled = true;
  assert.equal(station.claim(state, other, order.id).ok, true);
  assert.equal(station.receive(state, other, order.id).ok, true);
});

test("auto shelves follow prefix, block occupied shelves and release after admin pickup", () => {
  const state = createSeed(), account = state.stationAccounts[0];
  state.config.stationShelfPrefix = "A-";
  const first = newOrder(state), second = newOrder(state);
  const a = station.receive(state, account, first.id);
  assert.equal(a.order.shelfCode, "A-0001");
  assert.equal(station.receive(state, account, second.id, { shelfCode: a.order.shelfCode }).status, 409);
  assert.equal(station.receive(state, account, second.id).order.shelfCode, "A-0002");
  assert.equal(admin.verifyPickupOrder(state, first.id, first.pickupCode, actor, "test").ok, true);
  assert.equal(station.receive(state, account, newOrder(state).id).order.shelfCode, "A-0001");
});

test("station exceptions require physical recheck, preserve deadline and close linked ticket", () => {
  const state = createSeed(), account = state.stationAccounts[0], order = newOrder(state);
  station.receive(state, account, order.id, { idempotencyKey: "first" });
  const record = state.stationOrders.find(row => row.orderId === order.id);
  record.holdUntil = new Date(Date.now() - 1000).toISOString();
  const deadline = record.holdUntil;
  assert.equal(station.listOrders(state, account).find(row => row.id === order.id).overdue, true);
  station.createException(state, account, order.id, { type: "damaged", remark: "换货" });
  const ticket = state.operationTickets.find(row => row.linkedType === "station_exception");
  assert.equal(admin.updateTicket(state, ticket.id, { status: "resolved" }, actor).status, 409);
  assert.equal(admin.updateTicket(state, ticket.id, { status: "processing", adminReply: "安排补货" }, actor).ok, true);
  assert.equal(station.claim(state, account, order.id).ok, true);
  assert.equal(station.receive(state, account, order.id, { idempotencyKey: "recheck" }).ok, true);
  assert.equal(ticket.status, "resolved");
  assert.equal(record.holdUntil, deadline);
});

test("received refund retains physical shelf and stock until inventory inspection, then restocks once", async () => {
  const state = createSeed(), account = state.stationAccounts[0], order = newOrder(state);
  const product = state.products.find(row => row.id === "p_banana"), stock = product.stock;
  station.receive(state, account, order.id);
  const record = state.stationOrders.find(row => row.orderId === order.id);
  const refund = refunds.createRefundRequest(state, order.userId, order.id, "退货").refundOrder;
  assert.equal(refunds.approveRefund(state, refund.id).ok, true);
  assert.equal(product.stock, stock);
  assert.ok(record.shelfCode);
  assert.equal(returns.listReturns(state).some(row => row.orderId === order.id), true);
  assert.equal((await returns.resolveReturn(state, refund.id, { disposition: "restock", reason: "已验收" }, actor)).ok, true);
  assert.equal(product.stock, stock + 1);
  assert.equal(record.shelfCode, "");
  assert.equal((await returns.resolveReturn(state, refund.id, { disposition: "restock", reason: "重试" }, actor)).idempotent, true);
  assert.equal(product.stock, stock + 1);
});

test("invalid delivery configuration is atomic and legacy empty slots block checkout", () => {
  const state = createSeed(), before = JSON.stringify(state.config);
  assert.equal(admin.updateConfig(state, { deliveryTimeSlots: ["25:00-26:00"], deliveryFee: 99 }, actor).status, 400);
  assert.equal(JSON.stringify(state.config), before);
  state.config.deliveryTimeSlots = [];
  assert.equal(createOrder(state, "u_1001", { paymentMode: "pure_points", fulfillmentType: "delivery", deliveryAddress: "地址", deliveryTimeSlot: "09:00-11:00", items: [{ productId: "p_banana", quantity: 1 }] }).ok, false);
});
