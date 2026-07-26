const { createOrder } = require("../domain/rules");
const { createRefundRequest } = require("../domain/refund-rules");
const orderRepository = require("../repositories/order-repository");
const paymentService = require("./payment-service");

function subscribeMember(state, user, input = {}) {
  const paymentResult = paymentService.createMemberPayment(state, user, input);
  if (!paymentResult.ok) return paymentResult;
  if (input.autoPay === false) return paymentResult;

  const callbackResult = paymentService.mockPaymentCallback(state, paymentResult.payment.payNo, {
    status: "paid",
    thirdTradeNo: input.thirdTradeNo
  });
  if (!callbackResult.ok) return callbackResult;
  return {
    ok: true,
    user: callbackResult.result.user,
    payment: callbackResult.payment,
    idempotent: Boolean(paymentResult.idempotent || callbackResult.idempotent)
  };
}

function listUserOrders(state, userId) {
  return orderRepository.listByUser(state, userId);
}

function submitOrder(state, userId, payload) {
  return createOrder(state, userId, payload);
}

function createOrderPayment(state, orderId, input = {}) {
  return paymentService.createGoodsPayment(state, orderId, input);
}

function submitPayment(state, orderId, input = {}) {
  const paymentResult = createOrderPayment(state, orderId, input);
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

async function initiateLfwinPayment(state, payNo, input) {
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
  requestRefund
};
