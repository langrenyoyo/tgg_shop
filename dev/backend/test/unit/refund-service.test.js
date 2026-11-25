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
    assert.deepEqual(submitted.provider, {
      status: "10000",
      orderId: "PROVIDER-ORDER-1",
      merchantRefundNo: refund.merchantRefundNo,
      refundOrderId: "PROVIDER-REFUND-1",
      amount: refund.refundCashAmount
    });
    assert.equal(submitted.provider.secret, undefined);
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

test("v4 processing acknowledgement stays refunding without credit and signed list query settles once", async () => {
  const { state, refund, order } = cashRefundState();
  refundService.prepareRefundApproval(state, refund.id);
  const client = {
    refundPayment: async input => ({ status: "4001", orderid: input.providerOrderNo, mch_refund_no: input.merchantRefundNo, refund_no: "RF-1" }),
    queryRefund: async () => ({ status: "10000", lists: [{ orderid: refund.providerOrderNo, mch_refund_no: refund.merchantRefundNo, refund_no: "RF-1", refund_status: "1", refundmoney: refund.refundCashAmount }] })
  };
  const submit = await refundService.submitRefund(state, refund.id, {}, client);
  assert.equal(submit.ok, true); assert.equal(refund.status, "refunding"); assert.equal(refund.providerRefundNo, "RF-1");
  assert.equal(state.paymentLedger.filter(e => e.direction === "out").length, 0);
  assert.equal(state.exceptions.length, 0);
  assert.equal((await refundService.queryRefund(state, refund.id, client)).ok, true);
  const history = state.orderStatusLogs.length, inventory = state.inventoryLedger.length;
  assert.equal(refund.status, "refunded"); assert.equal(order.status, "refunded");
  assert.equal((await refundService.queryRefund(state, refund.id, client)).idempotent, true);
  assert.equal(state.orderStatusLogs.length, history); assert.equal(state.inventoryLedger.length, inventory);
  assert.equal(state.paymentLedger.filter(e => e.idempotencyKey === `refund:${refund.id}:cash`).length, 1);
});

test("signed list results must match one exact refund, payment and amount", async () => {
  for (const change of ["other-refund", "other-order", "duplicate", "empty", "amount", "missing-identity"]) {
    const { state, refund } = cashRefundState(); refundService.prepareRefundApproval(state, refund.id); refund.status = "unknown";
    const row = { orderid: refund.providerOrderNo, mch_refund_no: refund.merchantRefundNo, refund_status: "1", refundmoney: refund.refundCashAmount };
    if (change === "other-refund") row.mch_refund_no = "OTHER";
    if (change === "other-order") row.orderid = "OTHER";
    if (change === "amount") row.refundmoney = "0.01";
    const envelope = change === "missing-identity" ? { status: "1", refundmoney: refund.refundCashAmount } : { status: "10000", lists: change === "empty" ? [] : change === "duplicate" ? [row, row] : [row] };
    assert.equal((await refundService.queryRefund(state, refund.id, { queryRefund: async () => envelope })).ok, false, change);
    assert.equal(refund.status, "unknown");
    assert.equal(state.paymentLedger.some(e => e.idempotencyKey === `refund:${refund.id}:cash`), false);
  }
});

test("refund status 2 is failed, status 0 remains processing, neither settles", async () => {
  for (const status of ["0", "2"]) {
    const { state, refund } = cashRefundState(); refundService.prepareRefundApproval(state, refund.id);
    const response = { status: "10000", lists: [{ orderid: refund.providerOrderNo, mch_refund_no: refund.merchantRefundNo, refund_status: status, refundmoney: refund.refundCashAmount }] };
    await refundService.queryRefund(state, refund.id, { queryRefund: async () => response });
    assert.equal(refund.status, status === "0" ? "refunding" : "failed");
    assert.equal(state.paymentLedger.some(e => e.direction === "out"), false);
  }
});

test("successful callback closes uncertain exception and ticket, duplicates do not repeat history or credit", async () => {
  const { state, refund } = cashRefundState(); refundService.prepareRefundApproval(state, refund.id);
  await refundService.submitRefund(state, refund.id, {}, { refundPayment: async () => { throw new Error("timeout"); } });
  assert.equal(refund.status, "unknown"); const exception = state.exceptions[0];
  const callback = { orderid: refund.providerOrderNo, mch_refund_no: refund.merchantRefundNo, refund_orderid: "RF-1", refund_status: "1", refundmoney: refund.refundCashAmount };
  const client = { verifyNotification: () => true };
  assert.equal(refundService.handleRefundNotification(state, callback, client).ok, true);
  assert.equal(exception.status, "resolved");
  assert.equal(state.operationTickets.find(t => t.linkedId === exception.id).status, "resolved");
  const history = state.orderStatusLogs.length;
  assert.equal(refundService.handleRefundNotification(state, callback, client).idempotent, true);
  assert.equal(state.orderStatusLogs.length, history);
  assert.equal(refundService.handleRefundNotification(state, { ...callback, refund_status: "2" }, client).status, 409);
  assert.equal(refund.status, "refunded");
});

test("in-flight submit cannot overwrite a successful callback or send twice", async () => {
  const { state, refund } = cashRefundState(); refundService.prepareRefundApproval(state, refund.id);
  let reject, calls = 0;
  const client = { refundPayment: () => { calls++; return new Promise((_, fail) => { reject = fail; }); } };
  const pending = refundService.submitRefund(state, refund.id, {}, client);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await refundService.submitRefund(state, refund.id, {}, client)).status, 409);
  assert.equal(refundService.handleRefundNotification(state, { mch_refund_no: refund.merchantRefundNo, orderid: refund.providerOrderNo, refund_status: "1", refundmoney: refund.refundCashAmount }, { verifyNotification: () => true }).ok, true);
  reject(new Error("timeout"));
  assert.equal((await pending).ok, true); assert.equal(calls, 1); assert.equal(refund.status, "refunded"); assert.equal(state.exceptions.length, 0);
});

test("reconciliation worker only queries after a minute, rate-limits failures and never resubmits", async () => {
  const { state, refund } = cashRefundState(); refundService.prepareRefundApproval(state, refund.id);
  refund.status = "unknown"; refund.updatedAt = new Date().toISOString();
  let queries = 0;
  const worker = refundService.createWorker({ state: () => state, client: { isConfigured: () => true, queryRefund: async () => { queries++; throw new Error("offline"); }, refundPayment: () => { throw new Error("must not send"); } } });
  await worker.run(); assert.equal(queries, 0);
  refund.updatedAt = new Date(Date.now() - 61000).toISOString();
  await Promise.all([worker.run(), worker.run()]); assert.equal(queries, 1); assert.equal(refund.status, "unknown");
  await worker.run(); assert.equal(queries, 1);
  await worker.stop();
});

test("worker closes historical uncertainty only for refunded records with existing cash ledger", async () => {
  const { state, refund } = cashRefundState(); refundService.prepareRefundApproval(state, refund.id);
  await refundService.submitRefund(state, refund.id, {}, { refundPayment: async () => { throw new Error("timeout"); } });
  const exception = state.exceptions[0]; refund.status = "refunded";
  const worker = refundService.createWorker({ state: () => state, client: { isConfigured: () => true, queryRefund: () => { throw new Error("must not query terminal records"); } } });
  await worker.run(); assert.equal(exception.status, "pending");
  state.paymentLedger.push({ idempotencyKey: `refund:${refund.id}:cash`, amount: refund.refundCashAmount });
  const ledgerCount = state.paymentLedger.length, historyCount = state.orderStatusLogs.length;
  await worker.run(); assert.equal(exception.status, "resolved");
  assert.equal(state.paymentLedger.length, ledgerCount); assert.equal(state.orderStatusLogs.length, historyCount);
  await worker.stop();
});
