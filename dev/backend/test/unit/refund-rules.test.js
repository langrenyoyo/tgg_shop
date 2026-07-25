process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder, payOrder } = require("../../src/domain/rules");
const { createRefundRequest, approveRefund } = require("../../src/domain/refund-rules");
const { verifyPickup } = require("../../src/domain/fulfillment-rules");

test("pure-points refund returns points and marks order refunded", () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  const product = state.products.find((item) => item.id === "p_banana");
  const beforePoints = user.points;
  const beforeStock = product.stock;
  const orderResult = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "pickup",
    items: [{ productId: "p_banana", quantity: 1 }]
  });

  const refundResult = createRefundRequest(state, "u_1002", orderResult.order.id, "不想要了");
  assert.equal(refundResult.ok, true);
  assert.equal(refundResult.refundOrder.status, "pending_review");
  assert.equal(orderResult.order.status, "refunding");
  assert.equal(state.operationTickets[0].linkedType, "refund");
  assert.equal(state.operationTickets[0].linkedId, refundResult.refundOrder.id);
  assert.equal(state.operationTickets[0].status, "open");

  const duplicateRequest = createRefundRequest(state, "u_1002", orderResult.order.id, "重复申请");
  assert.equal(duplicateRequest.ok, true);
  assert.equal(duplicateRequest.idempotent, true);
  assert.equal(duplicateRequest.refundOrder.id, refundResult.refundOrder.id);
  assert.equal(state.refundOrders.length, 1);

  const approved = approveRefund(state, refundResult.refundOrder.id);
  assert.equal(approved.ok, true);
  assert.equal(approved.order.status, "refunded");
  assert.equal(user.points, beforePoints);
  assert.equal(product.stock, beforeStock);
  assert.equal(state.inventoryLedger[0].changeType, "refund_restore");
  assert.equal(state.inventoryLedger[0].quantityDelta, 1);
  assert.equal(state.pointLedger[0].changeType, "refund_return");
  assert.equal(state.pointLedger[0].bizNo, refundResult.refundOrder.id);
  assert.equal(state.operationTickets.find((ticket) => ticket.linkedId === refundResult.refundOrder.id).status, "resolved");

  const secondApprove = approveRefund(state, refundResult.refundOrder.id);
  assert.equal(secondApprove.ok, true);
  assert.equal(secondApprove.idempotent, true);
});

test("completed pickup refund does not restore stock automatically", () => {
  const state = createSeed();
  const product = state.products.find((item) => item.id === "p_banana");
  const beforeStock = product.stock;
  const orderResult = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "pickup",
    items: [{ productId: "p_banana", quantity: 1 }]
  });
  assert.equal(orderResult.ok, true);
  assert.equal(product.stock, beforeStock - 1);

  const fulfilled = verifyPickup(state, orderResult.order.id, orderResult.order.pickupCode);
  assert.equal(fulfilled.ok, true);
  assert.equal(orderResult.order.status, "completed");

  const refundResult = createRefundRequest(state, "u_1002", orderResult.order.id, "已提货售后退款");
  const approved = approveRefund(state, refundResult.refundOrder.id);

  assert.equal(approved.ok, true);
  assert.equal(product.stock, beforeStock - 1);
  assert.equal(state.inventoryLedger.some((entry) => entry.changeType === "refund_restore"), false);
});

test("cash refund writes outbound payment ledger", () => {
  const state = createSeed();
  const orderResult = createOrder(state, "u_1001", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });
  payOrder(state, orderResult.order.id);

  const refundResult = createRefundRequest(state, "u_1001", orderResult.order.id, "申请退款");
  const approved = approveRefund(state, refundResult.refundOrder.id);

  assert.equal(approved.ok, true);
  assert.equal(approved.refundOrder.refundCashAmount, orderResult.order.cashAmount);
  assert.equal(state.paymentLedger[0].direction, "out");
  assert.equal(state.paymentLedger[0].status, "refunded");
  assert.equal(state.paymentLedger[0].amount, orderResult.order.cashAmount);
});

test("cannot refund another user's order", () => {
  const state = createSeed();
  const orderResult = createOrder(state, "u_1001", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });
  payOrder(state, orderResult.order.id);

  const refundResult = createRefundRequest(state, "u_1002", orderResult.order.id, "恶意申请");
  assert.equal(refundResult.ok, false);
  assert.equal(refundResult.status, 403);
});
