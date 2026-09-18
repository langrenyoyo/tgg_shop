process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const { createRefundRequest, approveRefund } = require("../../src/domain/refund-rules");
test("production never books a cash refund through mock ledger", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const state = createSeed();
    const order = createOrder(state, "u_1001", { paymentMode: "cash", items: [{ productId: "p_apple", quantity: 1 }] }).order;
    order.status = "paid";
    const refund = createRefundRequest(state, "u_1001", order.id, "商品问题").refundOrder;
    const result = approveRefund(state, refund.id);
    assert.equal(result.status, 503);
    assert.equal(refund.status, "pending_review");
    assert.equal(state.paymentLedger.some(item => item.channel === "mock_refund"), false);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
