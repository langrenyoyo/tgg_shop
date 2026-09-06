process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createException, resolveException } = require("../../src/domain/exception-rules");
const { approveRefund } = require("../../src/domain/refund-rules");

test("can create and resolve exception compensation record", () => {
  const state = createSeed();
  const exception = createException(state, {
    type: "point_deduct_order_failed",
    bizNo: "TGG_TEST",
    action: "自动回滚积分",
    payload: { orderId: "TGG_TEST" }
  });

  assert.equal(exception.status, "pending");
  assert.equal(state.exceptions[0].id, exception.id);
  assert.equal(state.operationTickets[0].linkedType, "exception");
  assert.equal(state.operationTickets[0].linkedId, exception.id);
  assert.equal(state.operationTickets[0].priority, "high");

  const resolved = resolveException(state, exception.id, "人工确认已回滚");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.exception.status, "resolved");
  assert.equal(state.operationTickets[0].status, "resolved");

  const secondResolve = resolveException(state, exception.id);
  assert.equal(secondResolve.ok, false);
});

test("refund approval creates exception when linked data is missing", () => {
  const state = createSeed();
  state.refundOrders.unshift({
    id: "rf_broken",
    orderId: "missing_order",
    userId: "u_1001",
    refundCashAmount: 0,
    refundPointAmount: 10,
    status: "pending_review",
    reason: "broken fixture",
    idempotencyKey: "refund:broken",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const result = approveRefund(state, "rf_broken");
  assert.equal(result.ok, false);
  assert.equal(state.exceptions[0].type, "refund_data_missing");
  assert.equal(state.exceptions[0].bizNo, "rf_broken");
  assert.equal(state.operationTickets[0].linkedType, "exception");
});
