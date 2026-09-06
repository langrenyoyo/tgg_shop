const { saveState } = require("../data/store");
const { createException } = require("./exception-rules");
const orderRepository = require("../repositories/order-repository");
const { logOrderStatus } = require("./rules");

function verifyPickup(state, orderId, pickupCode) {
  const order = orderRepository.findById(state, orderId);
  const check = assertFulfillableOrder(order, "pickup");
  if (!check.ok) return check;
  if (order.fulfillmentStatus === "picked_up" && order.status === "completed") {
    return { ok: true, order, idempotent: true };
  }
  if (order.fulfillmentStatus !== "pending_pickup") {
    return { ok: false, status: 400, error: "当前自提状态不允许核销" };
  }
  if (!pickupCode || String(pickupCode) !== String(order.pickupCode)) {
    return { ok: false, status: 400, error: "核销码不正确" };
  }

  const previousStatus = order.status;
  const previousFulfillmentStatus = order.fulfillmentStatus;
  order.fulfillmentStatus = "picked_up";
  order.status = "completed";
  order.completedAt = new Date().toISOString();
  logOrderStatus(state, order, {
    fromStatus: previousStatus,
    toStatus: order.status,
    fromFulfillmentStatus: previousFulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    operatorType: "admin",
    reason: "代理核销自提码"
  });
  saveState();
  return { ok: true, order };
}

function shipOrder(state, orderId, staffId) {
  const order = orderRepository.findById(state, orderId);
  const check = assertFulfillableOrder(order, "delivery");
  if (!check.ok) return check;
  if (order.fulfillmentStatus === "shipping") return { ok: true, order, idempotent: true };
  if (order.fulfillmentStatus !== "pending_ship") {
    return { ok: false, status: 400, error: "当前配送状态不允许发货" };
  }

  const staffCheck = assertDeliveryStaffAvailable(state, staffId, order);
  if (!staffCheck.ok) return staffCheck;

  const previousFulfillmentStatus = order.fulfillmentStatus;
  order.fulfillmentStatus = "shipping";
  order.deliveryStaffId = staffId || null;
  const staff = staffCheck.staff;
  const team = staffCheck.team;
  order.deliveryStaffSnapshot = staff
    ? {
        name: staff.name,
        phone: staff.phone,
        teamName: team?.name || null
      }
    : null;
  order.shippedAt = new Date().toISOString();
  logOrderStatus(state, order, {
    fromStatus: order.status,
    toStatus: order.status,
    fromFulfillmentStatus: previousFulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    operatorType: "admin",
    reason: "后台发货并分配配送员"
  });
  saveState();
  return { ok: true, order };
}

function deliverOrder(state, orderId) {
  const order = orderRepository.findById(state, orderId);
  const check = assertFulfillableOrder(order, "delivery");
  if (!check.ok) return check;
  if (order.fulfillmentStatus === "delivered" && order.status === "completed") {
    return { ok: true, order, idempotent: true };
  }
  if (order.fulfillmentStatus !== "shipping") {
    return { ok: false, status: 400, error: "当前配送状态不允许完成送达" };
  }

  const previousStatus = order.status;
  const previousFulfillmentStatus = order.fulfillmentStatus;
  order.fulfillmentStatus = "delivered";
  order.status = "completed";
  order.completedAt = new Date().toISOString();
  logOrderStatus(state, order, {
    fromStatus: previousStatus,
    toStatus: order.status,
    fromFulfillmentStatus: previousFulfillmentStatus,
    toFulfillmentStatus: order.fulfillmentStatus,
    operatorType: "admin",
    reason: "配送完成送达"
  });
  saveState();
  return { ok: true, order };
}

function assertDeliveryStaffAvailable(state, staffId, order) {
  if (!staffId) {
    createDeliveryException(state, order, "delivery_staff_missing", "配送发货未指定配送员", { staffId });
    return { ok: false, status: 400, error: "请先指定自建配送员" };
  }
  const staff = state.deliveryStaff.find((item) => item.id === staffId);
  if (!staff || staff.enabled === false) {
    createDeliveryException(state, order, "delivery_staff_unavailable", "配送员不存在或已停用", { staffId });
    return { ok: false, status: 400, error: "配送员不存在或已停用，已进入异常补偿队列" };
  }
  const team = state.deliveryTeams.find((item) => item.id === staff.teamId);
  if (!team || team.enabled === false) {
    createDeliveryException(state, order, "delivery_team_unavailable", "配送团队不存在或已停用", { staffId, teamId: staff.teamId });
    return { ok: false, status: 400, error: "配送团队不可用，已进入异常补偿队列" };
  }
  return { ok: true, staff, team };
}

function createDeliveryException(state, order, type, action, payload = {}) {
  if (!order) return null;
  const existing = state.exceptions.find((item) => item.type === type && item.payload?.orderId === order.id && item.status !== "resolved");
  if (existing) return existing;
  return createException(state, {
    type,
    bizNo: order.id,
    action,
    payload: {
      orderId: order.id,
      userId: order.userId,
      fulfillmentType: order.fulfillmentType,
      fulfillmentStatus: order.fulfillmentStatus,
      compensationIdempotencyKey: `exception:${type}:${order.id}`,
      ...payload
    }
  });
}

function assertFulfillableOrder(order, fulfillmentType) {
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  if (order.fulfillmentType !== fulfillmentType) return { ok: false, status: 400, error: "订单履约方式不匹配" };
  if (!["paid", "completed"].includes(order.status)) return { ok: false, status: 400, error: "订单未支付或状态不允许履约" };
  return { ok: true };
}

module.exports = {
  verifyPickup,
  shipOrder,
  deliverOrder,
  createDeliveryException
};
