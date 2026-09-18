const { nextId, saveState } = require("../data/store");
const userRepository = require("../repositories/user-repository");
const orderRepository = require("../repositories/order-repository");
const refundRepository = require("../repositories/refund-repository");
const ledgerRepository = require("../repositories/ledger-repository");
const productRepository = require("../repositories/product-repository");
const inventoryRepository = require("../repositories/inventory-repository");
const ticketRepository = require("../repositories/ticket-repository");
const { createException } = require("./exception-rules");
const { logOrderStatus } = require("./rules");

function createRefundRequest(state, userId, orderId, reason = "用户申请退款") {
  const order = orderRepository.findById(state, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  if (order.userId !== userId) return { ok: false, status: 403, error: "不能申请他人订单退款" };

  const user = userRepository.findById(state, userId);
  if (!user) return { ok: false, status: 404, error: "用户不存在" };

  const existing = refundRepository.findByOrderId(state, order.id);
  if (existing) return { ok: true, refundOrder: existing, idempotent: true };

  if (!["paid", "completed"].includes(order.status)) return { ok: false, status: 400, error: "当前订单状态不允许退款" };

  const now = new Date().toISOString();
  const refundOrder = {
    id: nextId("rf"),
    orderId: order.id,
    userId,
    refundCashAmount: order.cashAmount || 0,
    refundPointAmount: order.pointAmount || 0,
    status: "pending_review",
    reason,
    idempotencyKey: `refund:${order.id}`,
    createdAt: now,
    updatedAt: now
  };

  const previousStatus = order.status;
  order.status = "refunding";
  logOrderStatus(state, order, {
    fromStatus: previousStatus,
    toStatus: order.status,
    fromFulfillmentStatus: order.fulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    reason: "用户提交退款申请"
  });
  refundRepository.add(state, refundOrder);
  ticketRepository.createLinked(state, {
    userId,
    type: "customer_service",
    subject: `退款跟进 ${order.id}`,
    content: `用户提交退款申请，退款单 ${refundOrder.id}，原因：${reason || "未填写"}`,
    contactName: user.nickname || "",
    contactPhone: user.phone || "",
    linkedType: "refund",
    linkedId: refundOrder.id,
    priority: order.fulfillmentStatus === "shipping" ? "high" : "normal"
  });
  saveState();
  return { ok: true, refundOrder };
}

function approveRefund(state, refundId) {
  const refundOrder = refundRepository.findById(state, refundId);
  if (!refundOrder) return { ok: false, status: 404, error: "退款单不存在" };
  if (refundOrder.status === "refunded") {
    return {
      ok: true,
      refundOrder,
      order: orderRepository.findById(state, refundOrder.orderId),
      idempotent: true
    };
  }
  if (refundOrder.status !== "pending_review") return { ok: false, status: 400, error: "退款单状态不允许审批" };
  if (process.env.NODE_ENV === "production" && refundOrder.refundCashAmount > 0) {
    return { ok: false, status: 503, error: "生产环境尚未配置真实退款通道，不能用模拟退款入账" };
  }

  const order = orderRepository.findById(state, refundOrder.orderId);
  const user = userRepository.findById(state, refundOrder.userId);
  if (!order || !user) {
    createException(state, {
      type: "refund_data_missing",
      bizNo: refundOrder.id,
      action: "人工核对退款单关联订单和用户",
      payload: { refundId, orderId: refundOrder.orderId, userId: refundOrder.userId }
    });
    return { ok: false, status: 400, error: "退款关联数据缺失" };
  }

  const now = new Date().toISOString();
  refundOrder.status = "refunded";
  refundOrder.updatedAt = now;
  const previousStatus = order.status;
  order.status = "refunded";
  restoreRefundableStock(state, order, refundOrder, now);
  if (["shipping", "delivered", "picked_up"].includes(order.fulfillmentStatus)) {
    ticketRepository.createLinked(state, {
      userId: user.id, type: "customer_service", linkedType: "refund_return", linkedId: refundOrder.id,
      subject: `退款商品去向核对 ${order.id}`,
      content: `退款单 ${refundOrder.id} 已完成账务处理，商品已出库或已交付，未自动增加可售库存。请核对是否退回、验收质量后由库存人员处理回库或损耗，并记录处理凭据。`,
      priority: "high", contactName: user.nickname || "", contactPhone: user.phone || ""
    });
  }
  logOrderStatus(state, order, {
    fromStatus: previousStatus,
    toStatus: order.status,
    fromFulfillmentStatus: order.fulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    operatorType: "admin",
    reason: "财务审批退款通过"
  });

  if (refundOrder.refundPointAmount > 0 && !state.pointLedger.some(entry => entry.idempotencyKey === `refund:${refundOrder.id}:points`)) {
    user.points += refundOrder.refundPointAmount;
    ledgerRepository.addPointEntry(state, {
      id: nextId("pt"),
      userId: user.id,
      changeType: "refund_return",
      direction: "in",
      points: refundOrder.refundPointAmount,
      balanceAfter: user.points,
      bizNo: refundOrder.id,
      idempotencyKey: `refund:${refundOrder.id}:points`,
      createdAt: now
    });
  }

  if (refundOrder.refundCashAmount > 0 && !state.paymentLedger.some(entry => entry.idempotencyKey === `refund:${refundOrder.id}:cash`)) {
    ledgerRepository.addPaymentEntry(state, {
      id: nextId("pay"),
      orderId: order.id,
      userId: user.id,
      direction: "out",
      amount: refundOrder.refundCashAmount,
      channel: process.env.NODE_ENV === "production" ? "provider_refund" : "mock_refund",
      status: "refunded",
      idempotencyKey: `refund:${refundOrder.id}:cash`,
      createdAt: now
    });
  }
  ticketRepository.resolveLinked(state, "refund", refundOrder.id, shouldRestoreStock(order) ? "退款审批已通过，账务及未出库库存回补已处理" : "退款账务已处理，已出库商品另有工单跟进去向，尚未自动回库", "system");

  saveState();
  return { ok: true, refundOrder, order };
}

function restoreRefundableStock(state, order, refundOrder, now) {
  if (!shouldRestoreStock(order)) return [];
  const entries = [];
  for (const item of order.items || []) {
    // The reason is already persisted by all store drivers, including SQLite.
    const stockReason = `退款未履约回补 ${order.id} / ${refundOrder.id}`;
    if ((state.inventoryLedger || []).some(entry => entry.productId === item.productId && entry.changeType === "refund_restore" && entry.reason === stockReason)) continue;
    const product = productRepository.findById(state, item.productId);
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (!product) {
      createException(state, {
        type: "refund_stock_restore_missing_product",
        bizNo: refundOrder.id,
        action: "人工核对退款库存回补商品",
        payload: {
          refundId: refundOrder.id,
          orderId: order.id,
          productId: item.productId,
          quantity,
          compensationIdempotencyKey: `refund:${refundOrder.id}:stock:${item.productId}`
        }
      });
      continue;
    }
    const stockBefore = Number(product.stock || 0);
    productRepository.incrementStock(product, quantity);
    entries.push(inventoryRepository.addEntry(state, {
      product,
      changeType: "refund_restore",
      quantityDelta: quantity,
      stockBefore,
      stockAfter: Number(product.stock || 0),
      reason: stockReason,
      operatorRoleId: "system",
      createdAt: now
    }));
  }
  return entries;
}

function shouldRestoreStock(order) {
  return ["not_started", "pending_pickup", "pending_ship"].includes(order.fulfillmentStatus);
}

module.exports = {
  createRefundRequest,
  approveRefund
};
