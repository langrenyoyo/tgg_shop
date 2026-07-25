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
  logOrderStatus(state, order, {
    fromStatus: previousStatus,
    toStatus: order.status,
    fromFulfillmentStatus: order.fulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    operatorType: "admin",
    reason: "财务审批退款通过"
  });

  if (refundOrder.refundPointAmount > 0) {
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

  if (refundOrder.refundCashAmount > 0) {
    ledgerRepository.addPaymentEntry(state, {
      id: nextId("pay"),
      orderId: order.id,
      direction: "out",
      amount: refundOrder.refundCashAmount,
      channel: "mock_refund",
      status: "refunded",
      idempotencyKey: `refund:${refundOrder.id}:cash`,
      createdAt: now
    });
  }
  ticketRepository.resolveLinked(state, "refund", refundOrder.id, "退款审批已通过，账务和库存处理已完成", "system");

  saveState();
  return { ok: true, refundOrder, order };
}

function restoreRefundableStock(state, order, refundOrder, now) {
  if (!shouldRestoreStock(order)) return [];
  const entries = [];
  for (const item of order.items || []) {
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
      reason: `退款未履约回补 ${order.id} / ${refundOrder.id}`,
      operatorRoleId: "system",
      createdAt: now
    }));
  }
  return entries;
}

function shouldRestoreStock(order) {
  return ["not_started", "pending_pickup", "pending_ship", "shipping"].includes(order.fulfillmentStatus);
}

module.exports = {
  createRefundRequest,
  approveRefund
};
