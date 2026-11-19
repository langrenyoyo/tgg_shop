const { createOrder, assertCanCreateOrder } = require("../domain/rules");
const { isGiftProduct } = require("../domain/product-membership");
const { checkPurchaseEligibility } = require("./purchase-eligibility-service");
const { createRefundRequest } = require("../domain/refund-rules");
const orderRepository = require("../repositories/order-repository");
const paymentService = require("./payment-service");
const { mockOperationsEnabled } = require("../config/runtime-safety");
const refundService = require("./refund-service");
const { publicUser } = require("../http/http-utils");

function subscribeMember(state, user, input = {}) {
  const paymentResult = paymentService.createMemberPayment(state, user, input);
  if (!paymentResult.ok) return paymentResult;
  return { ...paymentResult, user: publicUser(user) };
}

function listUserOrders(state, userId, query = {}) {
  let orders = orderRepository.listByUser(state, userId);
  if (query.status) orders = orders.filter(order => order.status === query.status);
  if (query.fulfillmentStatus) orders = orders.filter(order => order.fulfillmentStatus === query.fulfillmentStatus);
  if (query.page) {
    const count = Number(query.count || 20);
    orders = orders.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || String(b.id).localeCompare(String(a.id)));
    return orders.slice((Number(query.page) - 1) * count, Number(query.page) * count);
  }
  return orders;
}

async function submitOrder(state, userId, payload, dependencies = {}) {
  // Recover an existing order even when membership or the provider is now
  // unavailable. Payment has its own fresh gate; retries never deduct twice.
  if (payload?.idempotencyKey && state.orders.some(order => order.userId === userId && order.idempotencyKey === payload.idempotencyKey)) return createOrder(state, userId, payload);
  const check = assertCanCreateOrder(state, state.users.find(user => user.id === userId), payload);
  if (!check.ok) return check;
  const eligible = await checkPurchaseEligibility(state, userId, { ...dependencies, membershipRequired: check.paymentMode !== "pure_points" && !check.giftPurchase });
  if (!eligible.ok) return eligible;
  return createOrder(state, userId, payload);
}

function membershipRequired(state, order) {
  if (order.paymentMode === "pure_points") return false;
  if (typeof order.membershipRequired === "boolean") return order.membershipRequired;
  // Historical orders lack the server-derived snapshot.
  return !(order.paymentMode === "cash" && order.membershipGiftDays > 0 && order.items?.length
    && order.items.every(item => isGiftProduct(state.products.find(product => product.id === item.productId))));
}

async function checkOrderPayment(state, orderId, dependencies) {
  const order = orderRepository.findById(state, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  if (order.status !== "pending_payment") return { ok: true };
  return checkPurchaseEligibility(state, order.userId, { ...dependencies, membershipRequired: membershipRequired(state, order) });
}

async function createOrderPayment(state, orderId, input = {}, dependencies = {}) {
  const eligible = await checkOrderPayment(state, orderId, dependencies);
  if (!eligible.ok) return eligible;
  return paymentService.createGoodsPayment(state, orderId, input);
}

async function submitPayment(state, orderId, input = {}, dependencies = {}) {
  if (!mockOperationsEnabled()) return { ok: false, status: 503, error: "当前环境禁止模拟支付，请使用已配置的真实支付渠道" };
  const paymentResult = await createOrderPayment(state, orderId, input, dependencies);
  if (!paymentResult.ok) return paymentResult;

  const callbackResult = paymentService.mockPaymentCallback(state, paymentResult.payment.payNo, {
    status: "paid",
    thirdTradeNo: input.thirdTradeNo
  });
  if (!callbackResult.ok) return callbackResult;
  return {
    ok: true,
    order: callbackResult.result.order,
    payment: callbackResult.payment,
    idempotent: Boolean(paymentResult.idempotent || callbackResult.idempotent)
  };
}

function handlePaymentCallback(state, payNo, input = {}) {
  return paymentService.mockPaymentCallback(state, payNo, input);
}

function listUserPayments(state, userId) {
  return paymentService.listUserPayments(state, userId);
}

async function initiateLfwinPayment(state, payNo, input, dependencies = {}) {
  const payment = state.paymentLedger.find(item => item.payNo === payNo || item.id === payNo);
  if (payment?.orderId && payment.status === "pending") {
    const eligible = await checkOrderPayment(state, payment.orderId, dependencies);
    if (!eligible.ok) return eligible;
  }
  return paymentService.initiateLfwinPayment(state, payNo, input);
}

async function queryLfwinPayment(state, payNo) {
  return paymentService.queryLfwinPayment(state, payNo);
}

async function closeLfwinPayment(state, payNo) {
  return paymentService.closeLfwinPayment(state, payNo);
}

function handleLfwinPaymentNotification(state, payload) {
  return paymentService.applyLfwinPaymentNotification(state, payload);
}

function handleLfwinRefundNotification(state, payload) {
  return refundService.handleRefundNotification(state, payload);
}

function requestRefund(state, userId, orderId, reason) {
  return createRefundRequest(state, userId, orderId, reason);
}

module.exports = {
  subscribeMember,
  listUserOrders,
  submitOrder,
  createOrderPayment,
  submitPayment,
  handlePaymentCallback,
  listUserPayments,
  initiateLfwinPayment,
  queryLfwinPayment,
  closeLfwinPayment,
  handleLfwinPaymentNotification,
  handleLfwinRefundNotification,
  requestRefund
};
