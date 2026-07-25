const { nextId, saveState } = require("../data/store");
const userRepository = require("../repositories/user-repository");
const productRepository = require("../repositories/product-repository");
const orderRepository = require("../repositories/order-repository");
const ledgerRepository = require("../repositories/ledger-repository");
const inventoryRepository = require("../repositories/inventory-repository");

function isMember(user) {
  return Boolean(user.memberUntil && new Date(user.memberUntil).getTime() > Date.now());
}

function calcDeliveryDate(config, createdAt = new Date()) {
  const d = new Date(createdAt);
  const target = new Date(d);
  if (d.getHours() >= config.deliveryCutoffHour) {
    target.setDate(target.getDate() + 1);
  }
  return target.toISOString().slice(0, 10);
}

function assertCanCreateOrder(state, user, payload) {
  if (!user) return { ok: false, error: "用户不存在" };
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, error: "请选择商品" };
  }

  const paymentMode = payload.paymentMode || "pure_points";
  const fulfillmentType = payload.fulfillmentType || "pickup";
  if (fulfillmentType === "pickup" && !state.config.pickupEnabled) return { ok: false, error: "自提暂未开放" };
  if (fulfillmentType === "delivery" && !state.config.deliveryEnabled) return { ok: false, error: "送货上门暂未开放" };

  let cashAmount = 0;
  let pointAmount = 0;
  let pointsRequired = 0;
  let deliveryFee = 0;
  const items = [];

  for (const item of payload.items) {
    const product = productRepository.findActiveById(state, item.productId);
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (!product) return { ok: false, error: `商品不存在: ${item.productId}` };
    if (product.stock < quantity) return { ok: false, error: `${product.name} 库存不足` };

    items.push({ productId: product.id, quantity, title: product.name });

    if (paymentMode === "cash") {
      if (!isMember(user)) return { ok: false, error: "现金购物需要先开通月会员" };
      if (!product.supportsCash || product.cashPrice == null) return { ok: false, error: `${product.name} 不支持现金购买` };
      cashAmount += product.cashPrice * quantity;
    } else if (paymentMode === "points_plus_cash") {
      if (!isMember(user)) return { ok: false, error: "积分不足现金补差需要先开通月会员" };
      if (!product.supportsPoints) return { ok: false, error: `${product.name} 不支持积分抵扣` };
      pointsRequired += product.pointsPrice * quantity;
    } else {
      if (!product.supportsPoints) return { ok: false, error: `${product.name} 不支持积分兑换` };
      pointAmount += product.pointsPrice * quantity;
    }
  }

  if (paymentMode === "points_plus_cash") {
    pointAmount = Math.min(user.points, pointsRequired);
    cashAmount += Math.max(0, pointsRequired - pointAmount) / 10;
  }

  if (paymentMode === "pure_points" && user.points < pointAmount) {
    return { ok: false, error: "积分不足，纯积分兑换不支持现金补差" };
  }

  if (fulfillmentType === "delivery" && state.config.deliveryFeeEnabled && paymentMode !== "pure_points") {
    if (!isMember(user) && paymentMode !== "pure_points") return { ok: false, error: "配送费现金支付需要会员" };
    deliveryFee = Number(state.config.deliveryFee || 0);
    cashAmount += deliveryFee;
  }

  return { ok: true, items, cashAmount: roundMoney(cashAmount), pointAmount, paymentMode, fulfillmentType, deliveryFee };
}

function createOrder(state, userId, payload) {
  const user = userRepository.findById(state, userId);
  const check = assertCanCreateOrder(state, user, payload);
  if (!check.ok) return check;

  const now = new Date().toISOString();
  const isPurePoints = check.paymentMode === "pure_points";
  const pickupSite = state.pickupSites.find((site) => site.id === (payload.pickupSiteId || "site_001"));
  const order = {
    id: `TGG${Date.now()}`,
    userId,
    items: check.items,
    paymentMode: check.paymentMode,
    cashAmount: check.cashAmount,
    pointAmount: check.pointAmount,
    status: isPurePoints ? "paid" : "pending_payment",
    fulfillmentType: check.fulfillmentType,
    pickupSiteId: payload.pickupSiteId || "site_001",
    pickupSiteSnapshot: pickupSite
      ? {
          name: pickupSite.name,
          address: pickupSite.address,
          contactName: pickupSite.contactName,
          contactPhone: pickupSite.contactPhone
        }
      : null,
    pickupCode: isPurePoints ? String(Math.floor(100000 + Math.random() * 900000)) : null,
    deliveryAddress: payload.deliveryAddress || null,
    deliveryDate: check.fulfillmentType === "delivery" ? calcDeliveryDate(state.config) : null,
    deliveryTimeSlot: payload.deliveryTimeSlot || state.config.deliveryTimeSlots?.[0] || null,
    deliveryFee: check.deliveryFee || 0,
    fulfillmentStatus: isPurePoints
      ? check.fulfillmentType === "pickup"
        ? "pending_pickup"
        : "pending_ship"
      : "not_started",
    createdAt: now
  };

  for (const item of check.items) {
    const product = productRepository.findActiveById(state, item.productId);
    const stockBefore = Number(product.stock || 0);
    productRepository.decrementStock(product, item.quantity);
    inventoryRepository.addEntry(state, {
      product,
      changeType: "order_deduct",
      quantityDelta: -item.quantity,
      stockBefore,
      stockAfter: Number(product.stock || 0),
      reason: `订单提交扣减 ${order.id}`,
      operatorRoleId: "system"
    });
  }

  if (isPurePoints) {
    user.points -= check.pointAmount;
    ledgerRepository.addPointEntry(state, {
      id: nextId("pt"),
      userId,
      changeType: "exchange_deduct",
      direction: "out",
      points: check.pointAmount,
      balanceAfter: user.points,
      bizNo: order.id,
      idempotencyKey: `order:${order.id}:points`,
      createdAt: now
    });
  }

  orderRepository.add(state, order);
  logOrderStatus(state, order, {
    fromStatus: null,
    toStatus: order.status,
    fromFulfillmentStatus: null,
    toFulfillmentStatus: order.fulfillmentStatus,
    reason: "用户提交订单"
  });
  saveState();
  return { ok: true, order };
}

function payOrder(state, orderId) {
  const order = orderRepository.findById(state, orderId);
  if (!order) return { ok: false, error: "订单不存在" };
  const idempotencyKey = `order:${order.id}:pay`;
  const existingPayment = state.paymentLedger.find((item) => item.idempotencyKey === idempotencyKey);
  if (existingPayment && order.status === "paid") return { ok: true, order, idempotent: true };
  if (order.status !== "pending_payment") return { ok: false, error: "订单状态不允许支付" };

  order.status = "paid";
  const previousFulfillmentStatus = order.fulfillmentStatus;
  order.fulfillmentStatus = order.fulfillmentType === "pickup" ? "pending_pickup" : "pending_ship";
  order.pickupCode = order.fulfillmentType === "pickup" ? String(Math.floor(100000 + Math.random() * 900000)) : null;
  ledgerRepository.addPaymentEntry(state, {
    id: nextId("pay"),
    orderId,
    direction: "in",
    amount: order.cashAmount,
    channel: "mock_pay",
    status: "paid",
    idempotencyKey,
    createdAt: new Date().toISOString()
  });
  logOrderStatus(state, order, {
    fromStatus: "pending_payment",
    toStatus: "paid",
    fromFulfillmentStatus: previousFulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    reason: "模拟现金支付成功"
  });
  saveState();
  return { ok: true, order };
}

function logOrderStatus(state, order, input) {
  state.orderStatusLogs.unshift({
    id: nextId("osl"),
    orderId: order.id,
    operatorType: input.operatorType || "system",
    operatorId: input.operatorId || "system",
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    fromFulfillmentStatus: input.fromFulfillmentStatus,
    toFulfillmentStatus: input.toFulfillmentStatus,
    reason: input.reason || "",
    createdAt: new Date().toISOString()
  });
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  isMember,
  calcDeliveryDate,
  createOrder,
  payOrder,
  logOrderStatus
};
