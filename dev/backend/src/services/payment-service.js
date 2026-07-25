const { nextId, saveState } = require("../data/store");
const { createException } = require("../domain/exception-rules");
const { logOrderStatus } = require("../domain/rules");
const ledgerRepository = require("../repositories/ledger-repository");
const inventoryRepository = require("../repositories/inventory-repository");
const orderRepository = require("../repositories/order-repository");
const productRepository = require("../repositories/product-repository");
const userRepository = require("../repositories/user-repository");
const { publicUser } = require("../http/http-utils");

function listUserPayments(state, userId) {
  return state.paymentLedger.filter((payment) => payment.userId === userId);
}

function createGoodsPayment(state, orderId, input = {}) {
  const order = orderRepository.findById(state, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  if (order.status === "paid") {
    const existingPaid = state.paymentLedger.find((payment) => payment.orderId === order.id && payment.status === "paid" && payment.direction === "in");
    if (existingPaid) return { ok: true, payment: existingPaid, idempotent: true };
  }
  if (order.status !== "pending_payment") return { ok: false, status: 400, error: "订单状态不允许创建支付单" };

  const idempotencyKey = input.idempotencyKey || `payment:goods:${order.id}`;
  const existing = state.paymentLedger.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (existing) return { ok: true, payment: existing, idempotent: true };

  const now = new Date().toISOString();
  const payment = {
    id: nextId("pay"),
    payNo: `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`,
    orderId: order.id,
    userId: order.userId,
    payScene: order.paymentMode === "points_plus_cash" ? "cash_diff" : "goods_cash",
    direction: "in",
    amount: order.cashAmount || 0,
    pointAmount: order.pointAmount || 0,
    channel: input.channel || "mock_pay",
    status: "pending",
    idempotencyKey,
    metadata: { orderPaymentMode: order.paymentMode },
    createdAt: now,
    updatedAt: now
  };
  ledgerRepository.addPaymentEntry(state, payment);
  saveState();
  return { ok: true, payment };
}

function createMemberPayment(state, user, input = {}) {
  const months = Math.max(1, Number(input.months || 1));
  const price = Number(state.config.membershipMonthlyPrice || 19.9);
  const amount = roundMoney(price * months);
  const idempotencyKey = input.idempotencyKey || `payment:member:${user.id}:${months}:${Date.now()}`;
  const existing = state.paymentLedger.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (existing) return { ok: true, payment: existing, idempotent: true };

  const now = new Date().toISOString();
  const payment = {
    id: nextId("pay"),
    payNo: `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`,
    orderId: null,
    userId: user.id,
    payScene: "member_open",
    direction: "in",
    amount,
    pointAmount: 0,
    channel: input.channel || "mock_pay",
    status: "pending",
    idempotencyKey,
    metadata: { months, membershipMonthlyPrice: price },
    createdAt: now,
    updatedAt: now
  };
  ledgerRepository.addPaymentEntry(state, payment);
  saveState();
  return { ok: true, payment };
}

function mockPaymentCallback(state, payNo, input = {}) {
  const payment = state.paymentLedger.find((item) => item.payNo === payNo || item.id === payNo);
  if (!payment) return { ok: false, status: 404, error: "支付单不存在" };
  if (payment.status === "paid") return { ok: true, payment, result: getPaymentResult(state, payment), idempotent: true };
  if (payment.status !== "pending") return { ok: false, status: 400, error: "支付单状态不允许回调" };

  const now = new Date().toISOString();
  if (input.status === "failed") {
    payment.status = "failed";
    payment.callbackTime = now;
    payment.updatedAt = now;
    payment.thirdTradeNo = input.thirdTradeNo || `MOCK_FAIL_${payment.payNo}`;
    createPaymentException(state, payment, "payment_callback_failed", "支付回调失败，等待财务人工确认", {
      callbackStatus: input.status,
      thirdTradeNo: payment.thirdTradeNo
    });
    saveState();
    return { ok: true, payment, exception: findPaymentException(state, payment.id, "payment_callback_failed") };
  }

  payment.status = "paid";
  payment.callbackTime = now;
  payment.updatedAt = now;
  payment.thirdTradeNo = input.thirdTradeNo || `MOCK_${payment.payNo}`;

  const result = applyPaidPayment(state, payment);
  if (!result.ok) return result;
  saveState();
  return { ok: true, payment, result };
}

function cancelTimedOutPayments(state, input = {}) {
  const timeoutMinutes = Math.max(1, Number(input.timeoutMinutes || state.config?.paymentTimeoutMinutes || 30));
  const now = new Date(input.now || Date.now());
  const cutoff = now.getTime() - timeoutMinutes * 60 * 1000;
  const cancelled = [];

  for (const payment of state.paymentLedger) {
    if (payment.status !== "pending") continue;
    const createdAt = new Date(payment.createdAt || payment.updatedAt || now).getTime();
    if (!Number.isFinite(createdAt) || createdAt > cutoff) continue;

    payment.status = "cancelled";
    payment.updatedAt = now.toISOString();
    payment.metadata = {
      ...(payment.metadata || {}),
      cancelledReason: "payment_timeout",
      timeoutMinutes
    };
    const orderCancelResult = cancelPendingPaymentOrder(state, payment, now);
    createPaymentException(state, payment, "payment_timeout_cancelled", "支付单超时未回调，已取消并进入异常补偿队列", {
      timeoutMinutes,
      createdAt: payment.createdAt,
      orderCancelled: Boolean(orderCancelResult.orderCancelled),
      stockRestored: orderCancelResult.stockRestored
    });
    cancelled.push(payment);
  }

  if (cancelled.length) saveState();
  return { ok: true, timeoutMinutes, cancelled };
}

function cancelPendingPaymentOrder(state, payment, now) {
  if (!payment.orderId) return { orderCancelled: false, stockRestored: 0 };
  const order = orderRepository.findById(state, payment.orderId);
  if (!order || order.status !== "pending_payment") return { orderCancelled: false, stockRestored: 0 };

  let stockRestored = 0;
  for (const item of order.items || []) {
    const product = productRepository.findById(state, item.productId);
    if (!product) continue;
    const quantity = Math.max(1, Number(item.quantity || 1));
    const stockBefore = Number(product.stock || 0);
    productRepository.incrementStock(product, quantity);
    inventoryRepository.addEntry(state, {
      product,
      changeType: "order_restore",
      quantityDelta: quantity,
      stockBefore,
      stockAfter: Number(product.stock || 0),
      reason: `支付超时取消回补 ${order.id}`,
      operatorRoleId: "system"
    });
    stockRestored += quantity;
  }

  const previousFulfillmentStatus = order.fulfillmentStatus;
  order.status = "cancelled";
  order.cancelledAt = now.toISOString();
  order.cancelReason = "payment_timeout";
  logOrderStatus(state, order, {
    fromStatus: "pending_payment",
    toStatus: "cancelled",
    fromFulfillmentStatus: previousFulfillmentStatus,
    toFulfillmentStatus: previousFulfillmentStatus,
    reason: `支付超时 ${payment.payNo || payment.id}，订单取消并释放库存`
  });
  return { orderCancelled: true, stockRestored };
}

function applyPaidPayment(state, payment) {
  if (payment.payScene === "member_open") {
    const user = userRepository.findById(state, payment.userId);
    if (!user) return { ok: false, status: 400, error: "会员支付用户不存在" };
    const months = Math.max(1, Number(payment.metadata?.months || 1));
    const until = user.memberUntil && new Date(user.memberUntil) > new Date() ? new Date(user.memberUntil) : new Date();
    until.setMonth(until.getMonth() + months);
    user.role = "member";
    user.memberUntil = until.toISOString();
    return { ok: true, user: publicUser(user) };
  }

  const order = orderRepository.findById(state, payment.orderId);
  if (!order) return { ok: false, status: 400, error: "支付单关联订单不存在" };
  if (order.status === "paid") return { ok: true, order, idempotent: true };
  if (order.status !== "pending_payment") return { ok: false, status: 400, error: "订单状态不允许支付成功" };

  const previousFulfillmentStatus = order.fulfillmentStatus;
  order.status = "paid";
  order.fulfillmentStatus = order.fulfillmentType === "pickup" ? "pending_pickup" : "pending_ship";
  order.pickupCode = order.fulfillmentType === "pickup" ? String(Math.floor(100000 + Math.random() * 900000)) : null;

  if (order.paymentMode === "points_plus_cash" && order.pointAmount > 0) {
    const user = userRepository.findById(state, order.userId);
    if (!user) return { ok: false, status: 400, error: "订单用户不存在" };
    const pointKey = `order:${order.id}:points_after_cash`;
    if (!state.pointLedger.some((entry) => entry.idempotencyKey === pointKey)) {
      user.points -= order.pointAmount;
      ledgerRepository.addPointEntry(state, {
        id: nextId("pt"),
        userId: user.id,
        changeType: "shopping_deduct",
        direction: "out",
        points: order.pointAmount,
        balanceAfter: user.points,
        bizNo: order.id,
        idempotencyKey: pointKey,
        createdAt: new Date().toISOString()
      });
    }
  }

  logOrderStatus(state, order, {
    fromStatus: "pending_payment",
    toStatus: "paid",
    fromFulfillmentStatus: previousFulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    reason: `${payment.channel} 支付回调成功`
  });
  return { ok: true, order };
}

function getPaymentResult(state, payment) {
  if (payment.payScene === "member_open") {
    const user = userRepository.findById(state, payment.userId);
    return user ? { user: publicUser(user) } : {};
  }
  const order = orderRepository.findById(state, payment.orderId);
  return order ? { order } : {};
}

function createPaymentException(state, payment, type, action, payload = {}) {
  const existing = findPaymentException(state, payment.id, type);
  if (existing) return existing;
  return createException(state, {
    type,
    bizNo: payment.payNo || payment.id,
    action,
    payload: {
      paymentId: payment.id,
      payNo: payment.payNo,
      orderId: payment.orderId,
      userId: payment.userId,
      payScene: payment.payScene,
      channel: payment.channel,
      amount: payment.amount,
      pointAmount: payment.pointAmount,
      idempotencyKey: payment.idempotencyKey,
      compensationIdempotencyKey: `exception:${type}:${payment.id}`,
      ...payload
    }
  });
}

function findPaymentException(state, paymentId, type) {
  return state.exceptions.find((item) => item.type === type && item.payload?.paymentId === paymentId);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = {
  listUserPayments,
  createGoodsPayment,
  createMemberPayment,
  mockPaymentCallback,
  cancelTimedOutPayments
};
