const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder, payOrder } = require("../../src/domain/rules");
const { createRefundRequest } = require("../../src/domain/refund-rules");
const refundService = require("../../src/services/refund-service");

function cashRefundState() {
  const state = createSeed();
  const order = createOrder(state, "u_1001", { paymentMode: "cash", items: [{ productId: "p_apple", quantity: 1 }] }).order;
  assert.equal(payOrder(state, order.id).ok, true);
  const payment = state.paymentLedger.find(item => item.orderId === order.id && item.direction === "in");
  payment.metadata = { ...(payment.metadata || {}), lfwin: { providerOrderNo: "PROVIDER-ORDER-1" } };
  const refund = createRefundRequest(state, "u_1001", order.id, "service test").refundOrder;
  return { state, order, payment, refund };
}

test("provider refund approval and query settle cash only after provider success", async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldStoreMode = process.env.TGG_STORE_MODE;
  process.env.NODE_ENV = "production";
  process.env.TGG_STORE_MODE = "memory";
  try {
    const { state, order, refund } = cashRefundState();
    const prepared = refundService.prepareRefundApproval(state, refund.id);
    assert.equal(prepared.ok, true);
    assert.equal(refund.status, "approved");
    const client = {
      isConfigured: () => true,
      refundPayment: async input => ({ status: "10000", mch_orderid: input.merchantOrderNo, mch_refund_no: input.merchantRefundNo, orderid: input.providerOrderNo, refundmoney: input.amount, refund_orderid: "PROVIDER-REFUND-1" }),
      queryRefund: async input => ({ status: "1", mch_orderid: input.merchantOrderNo, mch_refund_no: input.merchantRefundNo, orderid: input.providerOrderNo, refundmoney: refund.refundCashAmount, refund_orderid: "PROVIDER-REFUND-1" })
    };
    const submitted = await refundService.submitRefund(state, refund.id, {}, client);
    assert.equal(submitted.ok, true);
    assert.equal(refund.status, "refunding");
    assert.equal(state.paymentLedger.some(item => item.idempotencyKey === `refund:${refund.id}:cash`), false);
    const queried = await refundService.queryRefund(state, refund.id, client);
    assert.equal(queried.ok, true);
    assert.equal(refund.status, "refunded");
    assert.equal(order.status, "refunded");
    assert.equal(state.paymentLedger.filter(item => item.idempotencyKey === `refund:${refund.id}:cash`).length, 1);
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    if (oldStoreMode === undefined) delete process.env.TGG_STORE_MODE; else process.env.TGG_STORE_MODE = oldStoreMode;
  }
});

test("provider timeout becomes unknown and cannot be retried without a query", async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldStoreMode = process.env.TGG_STORE_MODE;
  process.env.NODE_ENV = "production";
  process.env.TGG_STORE_MODE = "memory";
  try {
    const { state, refund } = cashRefundState();
    assert.equal(refundService.prepareRefundApproval(state, refund.id).ok, true);
    const failedClient = { isConfigured: () => true, refundPayment: async () => { throw new Error("timeout"); } };
    const submitted = await refundService.submitRefund(state, refund.id, {}, failedClient);
    assert.equal(submitted.ok, false);
    assert.equal(refund.status, "unknown");
    const retry = await refundService.submitRefund(state, refund.id, { retry: true }, failedClient);
    assert.equal(retry.status, 409);
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    if (oldStoreMode === undefined) delete process.env.TGG_STORE_MODE; else process.env.TGG_STORE_MODE = oldStoreMode;
  }
});

test("refund notification requires provider signature and exact identity", () => {
  const { state, refund } = cashRefundState();
  const client = { verifyNotification: () => false };
  assert.equal(refundService.handleRefundNotification(state, {}, client).status, 400);
  const trusted = { verifyNotification: () => true };
  assert.equal(refundService.handleRefundNotification(state, { mch_refund_no: "unknown", status: "1" }, trusted).status, 404);
  refund.status = "refunding";
  refund.merchantRefundNo = "RFD-1";
  refund.providerMerchantOrderNo = "PAY-1";
  refund.providerOrderNo = "PROVIDER-ORDER-1";
  const result = refundService.handleRefundNotification(state, { mch_refund_no: refund.merchantRefundNo, mch_orderid: "PAY-1", orderid: "PROVIDER-ORDER-1", refundmoney: refund.refundCashAmount, status: "1" }, trusted);
  assert.equal(result.ok, true);
  assert.equal(refund.status, "refunded");
});
