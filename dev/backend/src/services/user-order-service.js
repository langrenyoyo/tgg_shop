const { saveState } = require("../data/store");
const { logOrderStatus } = require("../domain/rules");
const { deliverOrder } = require("../domain/fulfillment-rules");
const inventory = require("../repositories/inventory-repository");
const payments = require("./payment-service");
const { exclusive } = require("./operation-lock");
const { releaseOrderPoints } = require("../domain/point-reservations");

function detail(state, userId, orderId) {
  const order = state.orders.find(item => item.id === orderId && item.userId === userId);
  if (!order) return null;
  return { ...order, refunds: state.refundOrders.filter(item => item.orderId === orderId && item.userId === userId), history: state.orderStatusLogs.filter(item => item.orderId === orderId) };
}

function refundDetail(state, userId, refundId) {
  const refund = state.refundOrders.find(item => item.id === refundId && item.userId === userId);
  if (!refund) return null;
  const order = state.orders.find(item => item.id === refund.orderId && item.userId === userId);
  return order ? { ...refund, order: { id: order.id, status: order.status, fulfillmentStatus: order.fulfillmentStatus } } : refund;
}

async function cancel(state, userId, orderId) {
  const order = state.orders.find(item => item.id === orderId && item.userId === userId);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  return exclusive(order, () => cancelOwned(state, userId, order));
}

async function cancelOwned(state, userId, order) {
  if (order.status === "cancelled") {
    await saveState();
    return { ok: true, order, idempotent: true };
  }
  if (order.status !== "pending_payment") return { ok: false, status: 409, error: "订单已支付或状态已变更，请刷新后申请退款" };
  const pending = state.paymentLedger.filter(item => item.orderId === order.id && item.status === "pending");
  for (const payment of pending) {
    if (payment.metadata?.lfwin?.submissionState && !payment.metadata.lfwin.providerOrderNo) return { ok: false, status: 409, error: "支付平台收单结果待核对，请先查询付款结果后再取消" };
    if (payment.metadata?.lfwin?.providerOrderNo) {
      const closed = await payments.closeLfwinPayment(state, payment.payNo);
      if (!closed.ok) return closed;
    }
  }
  // A provider callback may have arrived while the close request was in flight.
  if (order.status !== "pending_payment") return { ok: false, status: 409, error: "订单状态已变更，请刷新" };
  if (order.items.some(item => !state.products.some(product => product.id === item.productId))) return { ok: false, status: 409, error: "商品库存记录缺失，请联系客服处理取消" };
  const now = new Date().toISOString();
  releaseOrderPoints(state, order);
  for (const item of order.items) {
    const product = state.products.find(row => row.id === item.productId);
    const before = product.stock;
    product.stock += item.quantity;
    inventory.addEntry(state, { product, changeType: "order_restore", quantityDelta: item.quantity, stockBefore: before, stockAfter: product.stock, reason: `用户取消 ${order.id}` });
  }
  for (const payment of pending) { payment.status = "cancelled"; payment.updatedAt = now; }
  order.status = "cancelled";
  order.cancelledAt = now;
  order.cancelReason = "user_cancel";
  logOrderStatus(state, order, { fromStatus: "pending_payment", toStatus: "cancelled", fromFulfillmentStatus: order.fulfillmentStatus, toFulfillmentStatus: order.fulfillmentStatus, operatorType: "user", operatorId: userId, reason: "用户取消未支付订单" });
  await saveState();
  return { ok: true, order };
}

async function receive(state, userId, orderId) {
  const order = state.orders.find(item => item.id === orderId && item.userId === userId);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  const result = deliverOrder(state, order.id);
  if (result.ok && !result.idempotent) {
    const log = state.orderStatusLogs.find(item => item.orderId === order.id);
    if (log) { log.operatorType = "user"; log.operatorId = userId; log.reason = "用户确认收货"; }
  }
  if (result.ok) await saveState();
  return result;
}

module.exports = { detail, refundDetail, cancel, receive };
