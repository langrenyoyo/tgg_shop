process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const { verifyPickup, shipOrder, deliverOrder } = require("../../src/domain/fulfillment-rules");
const adminService = require("../../src/services/admin-service");

test("pickup order requires correct pickup code and completes order", () => {
  const state = createSeed();
  const created = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "pickup",
    items: [{ productId: "p_banana", quantity: 1 }]
  });

  const wrongCode = verifyPickup(state, created.order.id, "000000");
  assert.equal(wrongCode.ok, false);

  const verified = verifyPickup(state, created.order.id, created.order.pickupCode);
  assert.equal(verified.ok, true);
  assert.equal(verified.order.fulfillmentStatus, "picked_up");
  assert.equal(verified.order.status, "completed");

  const duplicate = verifyPickup(state, created.order.id, created.order.pickupCode);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
});

test("delivery dispatch creates exception when staff is unavailable", () => {
  const state = createSeed();
  const created = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "delivery",
    deliveryAddress: "师大东门宿舍 3 栋",
    items: [{ productId: "p_bokchoy", quantity: 1 }]
  });

  const result = shipOrder(state, created.order.id, "missing_staff");

  assert.equal(result.ok, false);
  assert.equal(created.order.fulfillmentStatus, "pending_ship");
  assert.equal(state.exceptions[0].type, "delivery_staff_unavailable");
  assert.equal(state.exceptions[0].payload.orderId, created.order.id);
  assert.equal(state.operationTickets[0].linkedType, "exception");
  assert.equal(state.operationTickets[0].priority, "high");
});

test("delivery timeout scan creates exception for stale shipping order", () => {
  const state = createSeed();
  const created = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "delivery",
    deliveryAddress: "师大东门宿舍 3 栋",
    items: [{ productId: "p_bokchoy", quantity: 1 }]
  });
  const shipped = shipOrder(state, created.order.id, "staff_001");
  assert.equal(shipped.ok, true);
  created.order.shippedAt = "2999-01-01T00:00:00.000Z";

  const result = adminService.scanDeliveryExceptions(state, {
    timeoutMinutes: 1,
    now: "2999-01-01T00:02:00.000Z"
  });

  assert.equal(result.ok, true);
  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].type, "delivery_timeout");
  assert.equal(state.operationTickets[0].linkedId, result.exceptions[0].id);
});

test("delivery order flows pending_ship to shipping to delivered", () => {
  const state = createSeed();
  const created = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "delivery",
    deliveryAddress: "师大东门宿舍 3 栋",
    items: [{ productId: "p_bokchoy", quantity: 1 }]
  });

  const deliveredTooEarly = deliverOrder(state, created.order.id);
  assert.equal(deliveredTooEarly.ok, false);

  const shipped = shipOrder(state, created.order.id, "staff_001");
  assert.equal(shipped.ok, true);
  assert.equal(shipped.order.fulfillmentStatus, "shipping");
  assert.equal(shipped.order.deliveryStaffId, "staff_001");

  const duplicateShip = shipOrder(state, created.order.id, "staff_001");
  assert.equal(duplicateShip.ok, true);
  assert.equal(duplicateShip.idempotent, true);

  const delivered = deliverOrder(state, created.order.id);
  assert.equal(delivered.ok, true);
  assert.equal(delivered.order.fulfillmentStatus, "delivered");
  assert.equal(delivered.order.status, "completed");

  const duplicateDeliver = deliverOrder(state, created.order.id);
  assert.equal(duplicateDeliver.ok, true);
  assert.equal(duplicateDeliver.idempotent, true);
});

test("pickup endpoint rejects delivery order", () => {
  const state = createSeed();
  const created = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "delivery",
    deliveryAddress: "师大东门宿舍 3 栋",
    items: [{ productId: "p_bokchoy", quantity: 1 }]
  });

  const result = verifyPickup(state, created.order.id, "123456");
  assert.equal(result.ok, false);
  assert.match(result.error, /履约方式不匹配/);
});
