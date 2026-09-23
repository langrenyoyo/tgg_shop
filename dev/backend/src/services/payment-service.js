const { nextId, saveState } = require("../data/store");
const { createException } = require("../domain/exception-rules");
const { logOrderStatus } = require("../domain/rules");
const ledgerRepository = require("../repositories/ledger-repository");
const inventoryRepository = require("../repositories/inventory-repository");
const orderRepository = require("../repositories/order-repository");
const productRepository = require("../repositories/product-repository");
const userRepository = require("../repositories/user-repository");
const { publicUser } = require("../http/http-utils");
const { createLfwinClient } = require("./lfwin-payment-client");
const { exclusive, isBusy } = require("./operation-lock");
const { releaseOrderPoints } = require("../domain/point-reservations");

function listUserPayments(state, userId) {
  return state.paymentLedger.filter((payment) => payment.userId === userId);
}

function createGoodsPayment(state, orderId, input = {}) {
  if (process.env.NODE_ENV === "production" && String(input.channel || "mock_pay").startsWith("mock")) return { ok: false, status: 400, error: "Mock payment is disabled in production" };
  const order = orderRepository.findById(state, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  if (isBusy(order)) return { ok: false, status: 409, error: "订单操作处理中" };
  if (order.status === "paid") {
    const existingPaid = state.paymentLedger.find((payment) => payment.orderId === order.id && payment.status === "paid" && payment.direction === "in");
    if (existingPaid) return { ok: true, payment: existingPaid, idempotent: true };
  }
  if (order.status !== "pending_payment") return { ok: false, status: 400, error: "订单状态不允许创建支付单" };
  const pending = state.paymentLedger.find(item => item.orderId === order.id && item.status === "pending");
  if (pending) return { ok: true, payment: pending, idempotent: true };

  const idempotencyKey = input.idempotencyKey || `payment:goods:${order.id}`;
  const existing = state.paymentLedger.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (existing) return existing.userId === order.userId && existing.orderId === order.id ? { ok: true, payment: existing, idempotent: true } : { ok: false, status: 409, error: "支付请求标识已被使用" };

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
  const months = Number(input.months || 1);
  if (!Number.isInteger(months) || months < 1 || months > 12) return { ok: false, status: 400, error: "会员月数必须为 1 至 12" };
  const price = Number(state.config.membershipMonthlyPrice || 19.9);
  const pointsRequired = Math.max(0, Math.floor(Number(state.config.membershipMonthlyPoints || 0) * months));
  const paymentMode = input.paymentMode || "cash";
  const pointCashRate = Math.max(0, Number(state.config.membershipPointCashRate ?? 0.01));
  if (!["cash", "pure_points", "points_plus_cash"].includes(paymentMode)) return { ok: false, status: 400, error: "不支持的会员开通方式" };
  if (paymentMode === "pure_points" && (!pointsRequired || user.points < pointsRequired)) return { ok: false, status: 400, error: pointsRequired ? `积分不足，开通需要 ${pointsRequired} 积分` : "后台尚未配置积分开通会员" };
  if (paymentMode === "points_plus_cash" && !pointsRequired) return { ok: false, status: 400, error: "后台尚未配置积分开通会员" };
  const pointAmount = paymentMode === "cash" ? 0 : Math.min(user.points, pointsRequired);
  const amount = roundMoney(Math.max(0, price * months - pointAmount * pointCashRate));
  if (process.env.NODE_ENV === "production" && amount > 0 && String(input.channel || "mock_pay").startsWith("mock")) return { ok: false, status: 400, error: "Mock payment is disabled in production" };
  const idempotencyKey = input.idempotencyKey || `payment:member:${user.id}:${months}:${Date.now()}`;
  const existing = state.paymentLedger.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (existing) return existing.userId === user.id && existing.payScene === "member_open" ? { ok: true, payment: existing, idempotent: true } : { ok: false, status: 409, error: "支付请求标识已被使用" };

  // Recover the same unpaid subscription across page reloads and devices.
  const pending = state.paymentLedger.find(payment => payment.userId === user.id && payment.payScene === "member_open" && payment.status === "pending" && payment.direction === "in");
  if (pending) {
    if (Number(pending.metadata?.months) !== months || (input.paymentMode && pending.metadata?.paymentMode !== input.paymentMode)) return { ok: false, status: 409, error: "已有待支付会员订单，请先处理原订单" };
    return { ok: true, payment: pending, idempotent: true };
  }

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
    channel: paymentMode === "pure_points" ? "points" : (input.channel || "mock_pay"),
    status: paymentMode === "pure_points" || amount === 0 ? "paid" : "pending",
    idempotencyKey,
    metadata: { months, membershipMonthlyPrice: price, paymentMode, pointsRequired, pointAmount, membershipPointCashRate: pointCashRate },
    createdAt: now,
    updatedAt: now
  };
  ledgerRepository.addPaymentEntry(state, payment);
  if (payment.status === "paid") {
    const result = applyPaidPayment(state, payment);
    if (!result.ok) return result;
    payment.callbackTime = now;
  }
  saveState();
  return { ok: true, payment };
}

async function initiateLfwinPayment(state, payNo, input = {}, client = createLfwinClient()) {
  const payment = state.paymentLedger.find((item) => item.payNo === payNo || item.id === payNo);
  if (!payment) return { ok: false, status: 404, error: "Payment not found" };
  const entity = state.orders.find(item => item.id === payment.orderId) || payment;
  return exclusive(entity, () => initiateLfwinLocked(state, payment, input, client));
}

async function initiateLfwinLocked(state, payment, input, client) {
  if (payment.status !== "pending") return { ok: false, status: 400, error: "Payment is not pending" };
  if (payment.orderId && state.orders.find(order => order.id === payment.orderId)?.status !== "pending_payment") return { ok: false, status: 409, error: "订单状态已变更" };

  if (["sending", "unknown"].includes(payment.metadata?.lfwin?.submissionState)) return { ok: false, status: 409, error: "上次支付发起结果待核对，请先查询付款结果" };
  payment.metadata = { ...(payment.metadata || {}), lfwin: {
    ...(payment.metadata?.lfwin || {}), submissionState: "sending", requestedAt: new Date().toISOString()
  } };
  // Persist intent before contacting a provider: a timeout is not proof of failure.
  await saveState();

  try {
    const response = await client.createPayment({
      method: input.method || "qrcode",
      service: input.service,
      amount: payment.amount,
      merchantOrderNo: payment.payNo,
      notifyUrl: process.env.LFWIN_NOTIFY_URL,
      description: input.description || payment.payScene,
      expireAt: input.expireAt,
      appId: input.appId,
      openId: input.openId,
      buyerId: input.buyerId,
      buyerOpenId: input.buyerOpenId,
      attach: payment.payNo
    });
    payment.channel = `lfwin_${input.method || "qrcode"}`;
    payment.metadata = {
      ...(payment.metadata || {}),
      lfwin: {
        providerOrderNo: response.orderid,
        submissionState: response.orderid ? "submitted" : "unknown",
        service: response.service,
        method: input.method || "qrcode",
        requestedAt: new Date().toISOString()
      }
    };
    payment.updatedAt = new Date().toISOString();
    await saveState();
    return {
      ok: true,
      payment,
      provider: {
        orderId: response.orderid,
        qrCode: response.qr_code,
        codeUrl: response.code_url,
        paymentUrl: response.pay_url || response.code_url,
        expiresAt: response.time_expire || null,
        requestPayment: input.method === "wechat_mini" ? parseMiniPayment(response) : null
      }
    };
  } catch (error) {
    payment.metadata.lfwin.submissionState = "unknown";
    createPaymentException(state, payment, "payment_initiation_uncertain", "支付平台收单结果待核对，请按商户单号查单", { error: error.message });
    await saveState();
    return { ok: false, status: 502, error: error.message };
  }
}

async function queryLfwinPayment(state, payNo, client = createLfwinClient()) {
  const payment = state.paymentLedger.find((item) => item.payNo === payNo || item.id === payNo);
  if (!payment) return { ok: false, status: 404, error: "Payment not found" };
  if (!payment.metadata?.lfwin?.providerOrderNo && !payment.metadata?.lfwin?.submissionState) return { ok: false, status: 400, error: "Payment has not been submitted to LFWin" };
  try {
    const response = await client.queryPayment({
      providerOrderNo: payment.metadata.lfwin.providerOrderNo,
      merchantOrderNo: payment.payNo,
      orderTime: payment.createdAt
    });
    if (response.mch_orderid && response.mch_orderid !== payment.payNo) return { ok: false, status: 400, error: "Payment order identity mismatch" };
    if (payment.metadata.lfwin.providerOrderNo && response.orderid && response.orderid !== payment.metadata.lfwin.providerOrderNo) return { ok: false, status: 400, error: "Payment order identity mismatch" };
    if (response.orderid) {
      payment.metadata.lfwin.providerOrderNo = response.orderid;
      payment.metadata.lfwin.submissionState = "submitted";
      await saveState();
    }
    if (String(response.paystatus) === "1") return applyLfwinPaymentNotification(state, response, client);
    return { ok: true, payment, provider: response };
  } catch (error) {
    return { ok: false, status: 502, error: error.message };
  }
}

async function closeLfwinPayment(state, payNo, client = createLfwinClient()) {
  const payment = state.paymentLedger.find((item) => item.payNo === payNo || item.id === payNo);
  if (!payment) return { ok: false, status: 404, error: "Payment not found" };
  if (payment.status !== "pending") return { ok: false, status: 400, error: "Payment is not pending" };
  if (!payment.metadata?.lfwin?.providerOrderNo) return { ok: false, status: 400, error: "Payment has not been submitted to LFWin" };
  try {
    const provider = await client.closePayment({
      providerOrderNo: payment.metadata.lfwin.providerOrderNo,
      merchantOrderNo: payment.payNo,
      orderTime: payment.createdAt
    });
    return { ok: true, payment, provider };
  } catch (error) {
    return { ok: false, status: 502, error: error.message };
  }
}

function applyLfwinPaymentNotification(state, payload, client = createLfwinClient()) {
  if (!client.verifyNotification(payload)) return { ok: false, status: 400, error: "Invalid LFWin signature" };
  const merchantNo = typeof payload.mch_orderid === "string" && payload.mch_orderid.trim() ? payload.mch_orderid : null;
  const providerNo = typeof payload.orderid === "string" && payload.orderid.trim() ? payload.orderid : null;
  if (!merchantNo && !providerNo) return { ok: false, status: 400, error: "Missing payment order identity" };
  const payment = state.paymentLedger.find((item) => (merchantNo && item.payNo === merchantNo) || (providerNo && item.metadata?.lfwin?.providerOrderNo === providerNo));
  if (!payment) return { ok: false, status: 404, error: "Payment not found" };
  if ((payload.mch_orderid && payload.mch_orderid !== payment.payNo) || (payment.metadata?.lfwin?.providerOrderNo && payload.orderid && payload.orderid !== payment.metadata.lfwin.providerOrderNo)) return { ok: false, status: 400, error: "Payment order identity mismatch" };
  if (payment.status === "paid") return { ok: true, payment, result: getPaymentResult(state, payment), idempotent: true };
  if (payment.status !== "pending") return { ok: false, status: 400, error: "Payment is not pending" };
  if (String(payload.paystatus) !== "1") return { ok: false, status: 400, error: "Payment notification is not successful" };
  if (!sameAmount(payment.amount, payload.pri_paymoney ?? payload.paymoney)) return { ok: false, status: 400, error: "Payment amount mismatch" };

  const result = applyPaidPayment(state, payment);
  if (!result.ok) {
    createPaymentException(state, payment, "payment_settlement_failed", "平台已付款，本地入账待核对", { error: result.error, providerOrderNo: payload.orderid });
    return result;
  }
  payment.status = "paid";
  payment.callbackTime = new Date().toISOString();
  payment.updatedAt = payment.callbackTime;
  payment.thirdTradeNo = payload.trade_no || payload.orderid;
  payment.metadata = {
    ...(payment.metadata || {}),
    lfwin: {
      ...(payment.metadata?.lfwin || {}),
      providerOrderNo: payload.orderid || payment.metadata?.lfwin?.providerOrderNo,
      paidAt: payload.paytime || null
    }
  };
  saveState();
  return { ok: true, payment, result };
}

function mockPaymentCallback(state, payNo, input = {}) {
  if (process.env.NODE_ENV === "production") return { ok: false, status: 403, error: "生产环境禁止模拟支付" };
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

  const result = applyPaidPayment(state, payment);
  if (!result.ok) return result;
  payment.status = "paid";
  payment.callbackTime = now;
  payment.updatedAt = now;
  payment.thirdTradeNo = input.thirdTradeNo || `MOCK_${payment.payNo}`;

  saveState();
  return { ok: true, payment, result };
}

function parseMiniPayment(response) {
  let data = response.pay_info || response.payInfo || response;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const fields = { timeStamp: String(data.timeStamp || ""), nonceStr: data.nonceStr, package: data.package, signType: data.signType || "RSA", paySign: data.paySign };
  if (!/^\d+$/.test(fields.timeStamp) || !fields.nonceStr || !String(fields.package || "").startsWith("prepay_id=") || !fields.paySign || !["RSA", "MD5", "HMAC-SHA256"].includes(fields.signType)) return null;
  return fields;
}

function cancelTimedOutPayments(state, input = {}) {
  const timeoutMinutes = Math.max(1, Number(input.timeoutMinutes || state.config?.paymentTimeoutMinutes || 30));
  const now = new Date(input.now || Date.now());
  const cutoff = now.getTime() - timeoutMinutes * 60 * 1000;
  const cancelled = [];

  for (const payment of state.paymentLedger) {
    if (payment.status !== "pending") continue;
    // Real provider orders must be queried/closed remotely before stock or
    // reserved points are released. Never expire them based on a local clock.
    if (payment.metadata?.lfwin?.providerOrderNo || payment.metadata?.lfwin?.submissionState || isBusy(state.orders.find(item => item.id === payment.orderId) || payment)) continue;
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
  releaseOrderPoints(state, order);

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
    const pointAmount = Math.max(0, Number(payment.metadata?.pointAmount || 0));
    if (pointAmount) {
      const pointKey = `member:${payment.id}:points`;
      if (!state.pointLedger.some(entry => entry.idempotencyKey === pointKey)) {
        if (user.points < pointAmount) return { ok: false, status: 409, error: "会员积分不足，无法完成结算" };
        user.points -= pointAmount;
        ledgerRepository.addPointEntry(state, { id: nextId("pt"), userId: user.id, changeType: "member_open", direction: "out", points: pointAmount, balanceAfter: user.points, bizNo: payment.payNo, idempotencyKey: pointKey, createdAt: new Date().toISOString() });
      }
    }
    const until = user.memberUntil && new Date(user.memberUntil) > new Date() ? new Date(user.memberUntil) : new Date();
    until.setDate(until.getDate() + months * 30);
    user.role = "member";
    user.memberUntil = until.toISOString();
    return { ok: true, user: publicUser(user) };
  }

  const order = orderRepository.findById(state, payment.orderId);
  if (!order) return { ok: false, status: 400, error: "支付单关联订单不存在" };
  if (order.status === "paid") return { ok: true, order, idempotent: true };
  if (order.status !== "pending_payment") return { ok: false, status: 400, error: "订单状态不允许支付成功" };

  const payingUser = userRepository.findById(state, order.userId);
  if (!payingUser) return { ok: false, status: 400, error: "订单用户不存在" };
  if (order.paymentMode === "points_plus_cash" && !order.pointsReserved && payingUser.points < order.pointAmount) return { ok: false, status: 409, error: "历史订单积分不足，需人工核对已支付款项" };

  const previousFulfillmentStatus = order.fulfillmentStatus;
  order.status = "paid";
  order.fulfillmentStatus = order.fulfillmentType === "pickup" ? "pending_pickup" : "pending_ship";
  order.pickupCode = order.fulfillmentType === "pickup" ? String(Math.floor(100000 + Math.random() * 900000)) : null;

  if (order.paymentMode === "points_plus_cash" && order.pointAmount > 0 && !order.pointsReserved) {
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
  order.pointsReserved = false;

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

function sameAmount(left, right) {
  const cents = value => {
    if (!["string", "number"].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
    const amount = Math.round(Number(value) * 100);
    return Number.isSafeInteger(amount) ? amount : null;
  };
  const expected = cents(left);
  const received = cents(right);
  return expected !== null && received !== null && expected === received;
}

module.exports = {
  listUserPayments,
  createGoodsPayment,
  createMemberPayment,
  initiateLfwinPayment,
  queryLfwinPayment,
  closeLfwinPayment,
  applyLfwinPaymentNotification,
  mockPaymentCallback,
  cancelTimedOutPayments
};
