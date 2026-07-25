process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const paymentService = require("../../src/services/payment-service");

test("timed-out payment cancels pending order and restores stock", () => {
  const state = createSeed();
  const product = state.products.find((item) => item.id === "p_apple");
  const beforeStock = product.stock;
  const orderResult = createOrder(state, "u_1001", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    pickupSiteId: "site_001",
    items: [{ productId: "p_apple", quantity: 2 }]
  });
  assert.equal(orderResult.ok, true);
  assert.equal(product.stock, beforeStock - 2);
  assert.equal(state.inventoryLedger[0].changeType, "order_deduct");
  assert.equal(state.inventoryLedger[0].quantityDelta, -2);
  assert.equal(state.inventoryLedger[0].stockBefore, beforeStock);
  assert.equal(state.inventoryLedger[0].stockAfter, beforeStock - 2);

  const paymentResult = paymentService.createGoodsPayment(state, orderResult.order.id, {
    idempotencyKey: "payment-timeout-test"
  });
  assert.equal(paymentResult.ok, true);

  const timeoutResult = paymentService.cancelTimedOutPayments(state, {
    timeoutMinutes: 1,
    now: "2999-01-01T00:00:00.000Z"
  });

  assert.equal(timeoutResult.ok, true);
  assert.equal(timeoutResult.cancelled.length, 1);
  assert.equal(timeoutResult.cancelled[0].status, "cancelled");
  assert.equal(orderResult.order.status, "cancelled");
  assert.equal(orderResult.order.fulfillmentStatus, "not_started");
  assert.equal(product.stock, beforeStock);
  assert.equal(state.inventoryLedger[0].changeType, "order_restore");
  assert.equal(state.inventoryLedger[0].quantityDelta, 2);
  assert.equal(state.inventoryLedger[0].stockBefore, beforeStock - 2);
  assert.equal(state.inventoryLedger[0].stockAfter, beforeStock);
  assert.equal(state.orderStatusLogs[0].toStatus, "cancelled");
  assert.equal(state.exceptions[0].payload.orderCancelled, true);
  assert.equal(state.exceptions[0].payload.stockRestored, 2);
});
