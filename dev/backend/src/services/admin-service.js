const { publicRole, requireAdminPermission, resolveAdmin } = require("../domain/auth");
const { createException, resolveException } = require("../domain/exception-rules");
const { verifyPickup, shipOrder, deliverOrder, createDeliveryException } = require("../domain/fulfillment-rules");
const { approveRefund } = require("../domain/refund-rules");
const { handleTaskCallback } = require("../domain/task-callback-rules");
const { nextId, saveState } = require("../data/store");
const {
  buildMonthlyPointRewardOverview,
  normalizeMonthlyPointRewardRules,
  reverseMonthlyPointReward,
  settleMonthlyPointRewards
} = require("./monthly-point-reward-service");
const adminRepository = require("../repositories/admin-repository");
const ledgerRepository = require("../repositories/ledger-repository");
const inventoryRepository = require("../repositories/inventory-repository");
const refundRepository = require("../repositories/refund-repository");
const taskRepository = require("../repositories/task-repository");
const userRepository = require("../repositories/user-repository");

function getAdminIdentity(req, state) {
  const admin = resolveAdmin(req, state);
  return admin.ok ? publicRole(admin.role) : null;
}

function requirePermission(req, state, permission) {
  return requireAdminPermission(req, state, permission);
}

function getSummary(state, filters = {}) {
  return {
    ...adminRepository.countSummary(state),
    analytics: buildAnalyticsSummary(state, filters)
  };
}

function buildAnalyticsSummary(state, filters = {}) {
  const orders = state.orders || [];
  const refunds = state.refunds || [];
  const exceptions = state.exceptions || [];
  const tasks = state.taskSubmissions || [];
  const paymentLedger = state.paymentLedger || [];
  const pointLedger = state.pointLedger || [];
  const users = state.users || [];
  const products = state.products || [];
  const helpers = createDateWindowHelpers();
  const normalizedFilters = normalizeDashboardFilters(filters);
  const alertThresholds = normalizeDashboardAlertThresholds(state.config?.dashboardAlertThresholds);
  const dashboardWindow = buildDashboardWindow(normalizedFilters, helpers);
  const rangeOrders = orders.filter((item) => helpers.inRange(item, dashboardWindow.start, dashboardWindow.end));
  const rangePayments = paymentLedger.filter((item) => helpers.inRange(item, dashboardWindow.start, dashboardWindow.end));
  const rangePoints = pointLedger.filter((item) => helpers.inRange(item, dashboardWindow.start, dashboardWindow.end));
  const rangeRefunds = refunds.filter((item) => helpers.inRange(item, dashboardWindow.start, dashboardWindow.end));
  const rangeTasks = tasks.filter((item) => helpers.inRange(item, dashboardWindow.start, dashboardWindow.end));
  const rangeExceptions = exceptions.filter((item) => helpers.inRange(item, dashboardWindow.start, dashboardWindow.end));
  const selectedOrders = rangeOrders.filter((item) => matchesDashboardOrder(item, normalizedFilters));
  const selectedPayments = rangePayments.filter((item) => matchesDashboardPayment(item, normalizedFilters));
  const selectedRefunds = rangeRefunds.filter((item) => matchesDashboardRefund(item, normalizedFilters));
  const selectedTasks = rangeTasks;
  const selectedExceptions = rangeExceptions;
  const selectedPointLedger = rangePoints;
  const summarizeDashboard = (daysBack) => {
    const start = helpers.since(daysBack);
    const end = helpers.until();
    const periodOrders = orders.filter((item) => helpers.inRange(item, start, end));
    const paidOrders = periodOrders.filter((item) => ["paid", "completed", "refunded"].includes(item.status));
    const periodPayments = paymentLedger.filter((item) => helpers.inRange(item, start, end));
    const periodPoints = pointLedger.filter((item) => helpers.inRange(item, start, end));
    const periodRefunds = refunds.filter((item) => helpers.inRange(item, start, end));
    const periodTasks = tasks.filter((item) => helpers.inRange(item, start, end));
    const periodExceptions = exceptions.filter((item) => helpers.inRange(item, start, end));
    return {
      orderCount: periodOrders.length,
      gmv: paidOrders.reduce((sum, item) => sum + Number(item.cashAmount || 0), 0),
      memberOpenCount: periodPayments.filter((item) => item.payScene === "member_open" && item.status === "paid").length,
      taskCount: periodTasks.length,
      refundCount: periodRefunds.length,
      refundCashAmount: periodRefunds.reduce((sum, item) => sum + Number(item.refundCashAmount || 0), 0),
      refundPointAmount: periodRefunds.reduce((sum, item) => sum + Number(item.refundPointAmount || 0), 0),
      exceptionCount: periodExceptions.length,
      pointNet: periodPoints.reduce((sum, item) => sum + (item.direction === "in" ? Number(item.points || 0) : -Number(item.points || 0)), 0)
    };
  };
  const summarizeUsers = (daysBack) => {
    const start = helpers.since(daysBack);
    const end = helpers.until();
    const periodUsers = users.filter((item) => helpers.inRange(item, start, end));
    const periodOrders = orders.filter((item) => helpers.inRange(item, start, end));
    const periodPayments = paymentLedger.filter((item) => helpers.inRange(item, start, end));
    const activeUserIds = new Set([
      ...periodOrders.map((item) => item.userId),
      ...periodPayments.map((item) => item.userId)
    ].filter(Boolean));
    const expiringSoonEnd = new Date(helpers.dayStart);
    expiringSoonEnd.setDate(expiringSoonEnd.getDate() + 30);
    return {
      newUsers: periodUsers.length,
      activeUsers: activeUserIds.size,
      memberOpenCount: periodPayments.filter((item) => item.payScene === "member_open" && item.status === "paid").length,
      expiringSoon: users.filter((item) => {
        if (!item.isMember || !item.memberUntil) return false;
        const date = new Date(item.memberUntil);
        return !Number.isNaN(date.getTime()) && date >= helpers.dayStart && date < expiringSoonEnd;
      }).length
    };
  };
  const summarizePoints = (daysBack) => {
    const start = helpers.since(daysBack);
    const end = helpers.until();
    const periodOrders = orders.filter((item) => item.paymentMode === "pure_points" && helpers.inRange(item, start, end));
    const periodPoints = pointLedger.filter((item) => helpers.inRange(item, start, end));
    const pointIn = periodPoints.filter((item) => item.direction === "in").reduce((sum, item) => sum + Number(item.points || 0), 0);
    const pointOut = periodPoints.filter((item) => item.direction === "out").reduce((sum, item) => sum + Number(item.points || 0), 0);
    return {
      pureOrderCount: periodOrders.length,
      purePointAmount: periodOrders.reduce((sum, item) => sum + Number(item.pointAmount || 0), 0),
      pointIn,
      pointOut,
      pointNet: pointIn - pointOut,
      deductCount: periodPoints.filter((item) => item.changeType === "order_deduct").length,
      refundPoints: periodPoints.filter((item) => item.changeType === "order_refund").reduce((sum, item) => sum + Number(item.points || 0), 0)
    };
  };
  const selected = {
    range: normalizedFilters.range,
    rangeLabel: dashboardWindow.label,
    startDate: normalizedFilters.startDate || "",
    endDate: normalizedFilters.endDate || "",
    orderStatus: normalizedFilters.orderStatus || "",
    fulfillmentStatus: normalizedFilters.fulfillmentStatus || "",
    paymentMode: normalizedFilters.paymentMode || "",
    payScene: normalizedFilters.payScene || "",
    orderCount: selectedOrders.length,
    gmv: selectedOrders.filter((item) => ["paid", "completed", "refunded"].includes(item.status)).reduce((sum, item) => sum + Number(item.cashAmount || 0), 0),
    memberOpenCount: selectedPayments.filter((item) => item.payScene === "member_open" && item.status === "paid").length,
    taskCount: selectedTasks.length,
    refundCount: selectedRefunds.length,
    refundCashAmount: selectedRefunds.reduce((sum, item) => sum + Number(item.refundCashAmount || 0), 0),
    refundPointAmount: selectedRefunds.reduce((sum, item) => sum + Number(item.refundPointAmount || 0), 0),
    refundLinkedCount: selectedRefunds.filter((item) => Boolean(item.orderId)).length,
    exceptionCount: selectedExceptions.length,
    pointNet: selectedPointLedger.reduce((sum, item) => sum + (item.direction === "in" ? Number(item.points || 0) : -Number(item.points || 0)), 0),
    pendingPickup: selectedOrders.filter((item) => item.fulfillmentStatus === "pending_pickup").length,
    pendingShip: selectedOrders.filter((item) => item.fulfillmentStatus === "pending_ship").length,
    orderStatusCounts: countBy(selectedOrders, (item) => item.status || "unknown"),
    fulfillmentCounts: countBy(selectedOrders, (item) => item.fulfillmentStatus || "unknown"),
    paymentModeCounts: countBy(selectedOrders, (item) => item.paymentMode || "unknown"),
    paySceneCounts: countBy(selectedPayments, (item) => item.payScene || "unknown"),
    exceptionTypeCounts: countBy(selectedExceptions, (item) => item.type || "unknown")
  };
  const trends = buildDashboardTrends(helpers, filters, orders, refunds, exceptions, paymentLedger, pointLedger, tasks);
  const alerts = buildDashboardAlerts(selected, alertThresholds);
  return {
    dashboard: {
      today: summarizeDashboard(0),
      week: summarizeDashboard(6),
      month: summarizeDashboard(29),
      current: {
        pendingPickup: orders.filter((item) => item.fulfillmentStatus === "pending_pickup").length,
        pendingShip: orders.filter((item) => item.fulfillmentStatus === "pending_ship").length
      },
      selected,
      trends,
      alerts,
      alertThresholds
    },
    users: {
      today: summarizeUsers(0),
      week: summarizeUsers(6),
      month: summarizeUsers(29),
      current: {
        totalUsers: users.length,
        memberUsers: users.filter((item) => item.isMember).length,
        normalUsers: users.filter((item) => !item.isMember).length,
        disabledUsers: users.filter((item) => item.status === "disabled").length
      }
    },
    points: {
      today: summarizePoints(0),
      week: summarizePoints(6),
      month: summarizePoints(29),
      current: {
        purePointsProducts: products.filter((item) => item.purePointsOnly).length
      }
    }
  };
}

function buildDashboardTrends(helpers, filters, orders, refunds, exceptions, paymentLedger, pointLedger, tasks) {
  const slices = {
    today: 0,
    week: 6,
    month: 29
  };
  const normalizedFilters = normalizeDashboardFilters(filters);
  return Object.fromEntries(Object.entries(slices).map(([key, startBack]) => {
    const start = helpers.since(startBack);
    const end = helpers.until();
    const periodOrders = orders.filter((item) => helpers.inRange(item, start, end) && matchesDashboardOrder(item, normalizedFilters));
    const periodPayments = paymentLedger.filter((item) => helpers.inRange(item, start, end));
    const periodPoints = pointLedger.filter((item) => helpers.inRange(item, start, end));
    const periodRefunds = refunds.filter((item) => helpers.inRange(item, start, end));
    const periodTasks = tasks.filter((item) => helpers.inRange(item, start, end));
    const periodExceptions = exceptions.filter((item) => helpers.inRange(item, start, end));
    const paidOrders = periodOrders.filter((item) => ["paid", "completed", "refunded"].includes(item.status));
    return [key, {
      orderCount: periodOrders.length,
      gmv: paidOrders.reduce((sum, item) => sum + Number(item.cashAmount || 0), 0),
      memberOpenCount: periodPayments.filter((item) => item.payScene === "member_open" && item.status === "paid").length,
      taskCount: periodTasks.length,
      refundCount: periodRefunds.length,
      exceptionCount: periodExceptions.length,
      pointNet: periodPoints.reduce((sum, item) => sum + (item.direction === "in" ? Number(item.points || 0) : -Number(item.points || 0)), 0)
    }];
  }));
}

function buildDashboardAlerts(selected, thresholds = normalizeDashboardAlertThresholds()) {
  const alerts = [];
  const orderCount = Math.max(1, Number(selected.orderCount || 0));
  const refundRate = Number(selected.refundCount || 0) / orderCount;
  const exceptionRate = Number(selected.exceptionCount || 0) / orderCount;
  const pendingShip = Number(selected.pendingShip || 0);
  const pendingPickup = Number(selected.pendingPickup || 0);
  if (refundRate >= thresholds.refundRate) {
    alerts.push({
      rule: "refundRate",
      tone: "red",
      title: "退款率偏高",
      text: `当前筛选范围退款率 ${Math.round(refundRate * 100)}%`,
      value: refundRate,
      threshold: thresholds.refundRate,
      drill: { type: "refunds", orderStatus: "refunded" }
    });
  }
  if (exceptionRate >= thresholds.exceptionRate) {
    alerts.push({
      rule: "exceptionRate",
      tone: "orange",
      title: "异常单偏多",
      text: `当前筛选范围异常 ${selected.exceptionCount} 条`,
      value: exceptionRate,
      threshold: thresholds.exceptionRate,
      drill: { type: "exceptions" }
    });
  }
  if (pendingShip >= thresholds.pendingShipCount) {
    alerts.push({
      rule: "pendingShipCount",
      tone: "amber",
      title: "待发货堆积",
      text: `待发货 ${pendingShip} 单，建议优先处理`,
      value: pendingShip,
      threshold: thresholds.pendingShipCount,
      drill: { type: "orders", fulfillmentStatus: "pending_ship" }
    });
  }
  if (pendingPickup >= thresholds.pendingPickupCount) {
    alerts.push({
      rule: "pendingPickupCount",
      tone: "blue",
      title: "待自提较多",
      text: `待自提 ${pendingPickup} 单，建议门店核销`,
      value: pendingPickup,
      threshold: thresholds.pendingPickupCount,
      drill: { type: "orders", fulfillmentStatus: "pending_pickup" }
    });
  }
  if (!alerts.length) {
    alerts.push({ rule: "healthy", tone: "green", title: "运行正常", text: "当前筛选范围内未发现明显预警", drill: { type: "orders" } });
  }
  return alerts;
}

function normalizeDashboardAlertThresholds(input = {}) {
  const thresholds = {
    refundRate: 0.1,
    exceptionRate: 0.08,
    pendingShipCount: 10,
    pendingPickupCount: 10
  };
  for (const key of Object.keys(thresholds)) {
    if (Number.isFinite(Number(input[key]))) thresholds[key] = Math.max(0, Number(input[key]));
  }
  return thresholds;
}

function normalizeDashboardViews(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item, index) => ({
      id: String(item.id || `view_${index + 1}`).trim(),
      name: String(item.name || "").trim(),
      filters: normalizeDashboardFilters(item.filters || {}),
      queueFilters: normalizeDashboardQueueFilters(item.queueFilters || {}),
      lastUsedAt: Number(item.lastUsedAt || 0) || 0,
      pinned: Boolean(item.pinned)
    }))
    .filter((item) => item.name);
}

function normalizeDashboardQueueFilters(filters) {
  const pick = (value, allowed) => {
    const raw = String(value || "all");
    return allowed.includes(raw) ? raw : "all";
  };
  return {
    refundType: pick(filters.refundType, ["all", "linked", "cash_only", "points_involved"]),
    exceptionType: pick(filters.exceptionType, ["all", ...Object.keys(exceptionTypeLabels())])
  };
}

function exceptionTypeLabels() {
  return {
    payment_callback_failed: true,
    payment_timeout_cancelled: true,
    point_deduct_failed: true,
    point_rollback_failed: true,
    refund_missing_linked_data: true,
    task_callback_missing_submission: true,
    delivery_exception: true,
    delivery_timeout: true,
    delivery_staff_missing: true,
    delivery_staff_unavailable: true,
    delivery_team_unavailable: true,
    inventory_shortage: true
  };
}

function normalizeDashboardFilters(filters) {
  const startDate = normalizeDashboardDate(filters.startDate);
  const endDate = normalizeDashboardDate(filters.endDate);
  const customRange = Boolean(startDate && endDate);
  const range = customRange
    ? "custom"
    : (["today", "week", "month"].includes(filters.range) ? filters.range : "month");
  const pick = (value) => (value && value !== "all" ? String(value) : "");
  return {
    range,
    startDate,
    endDate,
    orderStatus: pick(filters.orderStatus || filters.status),
    fulfillmentStatus: pick(filters.fulfillmentStatus || filters.fulfillment),
    paymentMode: pick(filters.paymentMode),
    payScene: pick(filters.payScene)
  };
}

function buildDashboardWindow(filters, helpers) {
  if (filters.range === "custom" && filters.startDate && filters.endDate) {
    const start = new Date(`${filters.startDate}T00:00:00`);
    const end = new Date(`${filters.endDate}T23:59:59.999`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      return { start, end, label: `${filters.startDate} 至 ${filters.endDate}` };
    }
  }
  const rangeDays = ({ today: 0, week: 6, month: 29 })[filters.range] ?? 29;
  const start = helpers.since(rangeDays);
  const end = helpers.until();
  return {
    start,
    end,
    label: ({ today: "今日", week: "近7日", month: "近30日" })[filters.range] || "近30日"
  };
}

function normalizeDashboardDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function matchesDashboardOrder(order, filters) {
  if (filters.orderStatus && order.status !== filters.orderStatus) return false;
  if (filters.fulfillmentStatus && order.fulfillmentStatus !== filters.fulfillmentStatus) return false;
  if (filters.paymentMode && order.paymentMode !== filters.paymentMode) return false;
  return true;
}

function matchesDashboardPayment(payment, filters) {
  if (filters.payScene && payment.payScene !== filters.payScene) return false;
  return true;
}

function matchesDashboardRefund(refund, filters) {
  if (filters.orderStatus && filters.orderStatus !== "refunded" && refund.status !== filters.orderStatus) return false;
  return true;
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = getter(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function createDateWindowHelpers() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const since = (days) => {
    const start = new Date(dayStart);
    start.setDate(start.getDate() - days);
    return start;
  };
  const until = () => {
    const end = new Date(dayStart);
    end.setDate(end.getDate() + 1);
    return end;
  };
  const inRange = (item, start, end) => {
    const raw = item?.createdAt || item?.createtime || item?.updatedAt || item?.updated_at;
    const date = raw ? new Date(raw) : null;
    return date && !Number.isNaN(date.getTime()) && date >= start && date < end;
  };
  return { dayStart, since, until, inRange };
}

function getLedger(state, filters = {}) {
  const ledger = ledgerRepository.getLedger(state);
  const paymentStatus = filters.paymentStatus || filters.status;
  const payScene = filters.payScene || filters.scene;
  const channel = filters.channel;
  return {
    ...ledger,
    paymentLedger: ledger.paymentLedger.filter((payment) => {
      if (paymentStatus && payment.status !== paymentStatus) return false;
      if (payScene && payment.payScene !== payScene) return false;
      if (channel && payment.channel !== channel) return false;
      return true;
    })
  };
}

function listRoles(state) {
  return adminRepository.listRoles(state);
}

function listDashboardViews(state, actor = {}) {
  const roleId = actor.role?.id || actor.id || "unknown";
  return normalizeDashboardViews(state.config?.dashboardViewsByRole?.[roleId] || []);
}

function saveDashboardViews(state, input = {}, actor = {}) {
  const roleId = actor.role?.id || actor.id || "unknown";
  const views = normalizeDashboardViews(input.views || []);
  state.config.dashboardViewsByRole ||= {};
  state.config.dashboardViewsByRole[roleId] = views;
  logOperation(state, actor, "config.update", "config", `dashboard_views:${roleId}`, {
    before: {},
    after: { roleId, views },
    reason: cleanReason(input.reason || "保存仪表盘视图")
  });
  saveState();
  return { roleId, views };
}

function listExceptions(state) {
  return adminRepository.listExceptions(state);
}

function listRefunds(state) {
  return refundRepository.listAll(state);
}

function listWithdrawals(state) {
  return state.withdrawRequests;
}

function listUsers(state) {
  return state.users.map((user) => ({
    ...user,
    status: user.status || "active",
    isMember: Boolean(user.memberUntil && new Date(user.memberUntil).getTime() > Date.now()),
    memberDaysLeft: user.memberUntil ? Math.max(0, Math.ceil((new Date(user.memberUntil).getTime() - Date.now()) / 86400000)) : 0
  }));
}

function listAddresses(state) {
  return (state.addresses || []).map((address) => ({
    ...address,
    userName: userRepository.findById(state, address.userId)?.nickname || address.userId || "-"
  }));
}

function listInviteAudits(state) {
  return (state.inviteRelations || []).map((relation) => {
    const inviter = userRepository.findById(state, relation.inviterUserId);
    const invitee = userRepository.findById(state, relation.inviteeUserId);
    const commissionEntries = (state.pointLedger || []).filter((entry) =>
      entry.userId === relation.inviterUserId
      && entry.changeType === "invite_commission"
      && String(entry.bizNo || "").includes(relation.inviteeUserId)
    );
    return {
      ...relation,
      inviterName: inviter?.nickname || relation.inviterUserId,
      inviterCode: inviter?.inviteCode || "",
      inviteeName: invitee?.nickname || relation.inviteeUserId,
      inviteeStatus: invitee?.status || "unknown",
      commissionPoints: commissionEntries.reduce((sum, entry) => sum + Number(entry.points || 0), 0),
      commissionCount: commissionEntries.length
    };
  });
}

function listInventoryLedger(state) {
  return inventoryRepository.listWithProduct(state);
}

function updateUser(state, userId, input = {}, actor = {}) {
  const user = userRepository.findById(state, userId);
  if (!user) return { ok: false, status: 404, error: "operation failed" };
  const before = { ...user };

  if (["active", "disabled"].includes(input.status)) user.status = input.status;
  if (typeof input.nickname === "string" && input.nickname.trim()) user.nickname = input.nickname.trim();
  if (typeof input.phone === "string") user.phone = input.phone.trim();
  if (Number.isFinite(Number(input.memberMonths))) {
    const months = Math.max(0, Math.floor(Number(input.memberMonths)));
    if (months > 0) {
      const until = user.memberUntil && new Date(user.memberUntil) > new Date() ? new Date(user.memberUntil) : new Date();
      until.setMonth(until.getMonth() + months);
      user.role = "member";
      user.memberUntil = until.toISOString();
    }
  }
  if (input.clearMember === true) {
    user.role = "normal";
    user.memberUntil = null;
  }
  user.status ||= "active";

  logOperation(state, actor, "user.update", "user", user.id, { before, after: user, reason: cleanReason(input.reason) });
  saveState();
  return { ok: true, user };
}

function listTickets(state) {
  return (state.operationTickets || []).map((ticket) => ({
    ...ticket,
    userName: userRepository.findById(state, ticket.userId)?.nickname || ticket.userId || "-"
  }));
}

function updateTicket(state, ticketId, input = {}, actor = {}) {
  const ticket = (state.operationTickets || []).find((item) => item.id === ticketId);
  if (!ticket) return { ok: false, status: 404, error: "operation failed" };
  const before = { ...ticket };
  if (["open", "processing", "resolved", "closed"].includes(input.status)) ticket.status = input.status;
  if (typeof input.adminReply === "string") ticket.adminReply = input.adminReply.trim();
  ticket.handledByRoleId = actor.role?.id || actor.id || ticket.handledByRoleId || "";
  ticket.updatedAt = new Date().toISOString();
  logOperation(state, actor, "ticket.update", "ticket", ticket.id, { before, after: ticket, reason: cleanReason(input.reason) });
  saveState();
  return { ok: true, ticket };
}

function updateConfig(state, input, actor = {}) {
  const before = { ...state.config };
  const booleanKeys = ["pickupEnabled", "deliveryEnabled", "deliveryFeeEnabled", "splashAdEnabled"];
  const numberKeys = [
    "membershipMonthlyPrice",
    "deliveryFee",
    "deliveryCutoffHour",
    "rankingRefreshMinutes",
    "inviteRewardPoints",
    "inviteCommissionRate",
    "monthlyPointRewardSettlementHour",
    "monthlyPointRewardSettlementMinute",
    "signinAdGroupMin",
    "signinAdGroupMax",
    "signinStreakDays",
    "lotteryDailyLimit",
    "withdrawMinAmount",
    "withdrawFeeRate",
    "paymentTimeoutMinutes"
  ];
  const textKeys = ["signinStreakRewardText", "homeBannerTitle", "homeBannerSubtitle", "homeBannerProductId"];

  for (const key of booleanKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) state.config[key] = Boolean(input[key]);
  }
  for (const key of numberKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key) && Number.isFinite(Number(input[key]))) {
      state.config[key] = Number(input[key]);
    }
  }
  for (const key of textKeys) {
    if (typeof input[key] === "string") state.config[key] = input[key].trim();
  }
  if (Array.isArray(input.deliveryTimeSlots)) {
    state.config.deliveryTimeSlots = input.deliveryTimeSlots.map(String).filter(Boolean);
  }
  if (Array.isArray(input.homeServiceBadges)) {
    state.config.homeServiceBadges = input.homeServiceBadges.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (Array.isArray(input.homePromotionEntries)) {
    state.config.homePromotionEntries = input.homePromotionEntries
      .map((item) => ({
        title: String(item.title || "").trim(),
        text: String(item.text || "").trim(),
        tone: String(item.tone || "green").trim(),
        page: String(item.page || "category").trim()
      }))
      .filter((item) => item.title);
  }
  if (typeof input.monthlyPointRewardRulesJson === "string") {
    state.config.monthlyPointRewardRules = normalizeMonthlyPointRewardRules(parseJsonArray(input.monthlyPointRewardRulesJson, state.config.monthlyPointRewardRules));
  } else if (Array.isArray(input.monthlyPointRewardRules)) {
    state.config.monthlyPointRewardRules = normalizeMonthlyPointRewardRules(input.monthlyPointRewardRules);
  }
  delete state.config.monthlyPointRewardRulesJson;
  if (typeof input.monthlyPointRewardEnabled === "boolean") {
    state.config.monthlyPointRewardEnabled = input.monthlyPointRewardEnabled;
  }
  if (input.homeDeliveryPromise && typeof input.homeDeliveryPromise === "object") {
    state.config.homeDeliveryPromise = {
      ...(state.config.homeDeliveryPromise || {}),
      ...Object.fromEntries(Object.entries(input.homeDeliveryPromise).map(([key, value]) => [key, String(value || "").trim()]))
    };
  }
  if (Array.isArray(input.signinAdMaterials)) {
    state.config.signinAdMaterials = input.signinAdMaterials
      .map((item, index) => ({
        id: String(item.id || `ad_${index + 1}`).trim(),
        name: String(item.name || "").trim(),
        type: String(item.type || "reward_video").trim(),
        enabled: item.enabled !== false,
        position: String(item.position || "").trim()
      }))
      .filter((item) => item.name);
  }
  if (input.dashboardAlertThresholds && typeof input.dashboardAlertThresholds === "object") {
    state.config.dashboardAlertThresholds = normalizeDashboardAlertThresholds(input.dashboardAlertThresholds);
  }
  state.config.purePointsNoCashTopup = true;

  logOperation(state, actor, "config.update", "config", "system", { before, after: state.config, reason: cleanReason(input.reason) });
  saveState();
  return state.config;
}

function parseJsonArray(value, fallback = []) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function updateProduct(state, productId, input, actor = {}) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return { ok: false, status: 404, error: "operation failed" };

  const before = { ...product };
  const stockBefore = Number(product.stock || 0);
  if (["on", "off"].includes(input.status)) product.status = input.status;
  if (Number.isFinite(Number(input.stock))) product.stock = Math.max(0, Math.floor(Number(input.stock)));
  if (Number.isFinite(Number(input.pointsPrice))) product.pointsPrice = Math.max(0, Math.floor(Number(input.pointsPrice)));
  if (!product.purePointsOnly && Object.prototype.hasOwnProperty.call(input, "cashPrice")) {
    product.cashPrice = input.cashPrice === null ? null : Math.max(0, roundMoney(input.cashPrice));
  }
  for (const key of ["name", "category", "tag", "image"]) {
    if (typeof input[key] === "string" && input[key].trim()) product[key] = input[key].trim();
  }
  if (typeof input.supportsPoints === "boolean") product.supportsPoints = input.supportsPoints;
  if (!product.purePointsOnly && typeof input.supportsCash === "boolean") product.supportsCash = input.supportsCash;
  if (product.purePointsOnly) {
    product.cashPrice = null;
    product.supportsCash = false;
    product.supportsPoints = true;
  }
  if (Number.isFinite(Number(input.stock)) && Number(product.stock || 0) !== stockBefore) {
    inventoryRepository.addEntry(state, {
      product,
      changeType: inventoryRepository.inferAdminChangeType(stockBefore, product.stock, input.inventoryChangeType),
      quantityDelta: Number(product.stock || 0) - stockBefore,
      stockBefore,
      stockAfter: Number(product.stock || 0),
      batchNo: input.batchNo,
      reason: input.reason || "admin operation",
      actor
    });
  }

  logOperation(state, actor, "product.update", "product", product.id, { before, after: product, reason: cleanReason(input.reason) });
  saveState();
  return { ok: true, product };
}

function createProduct(state, input, actor = {}) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, status: 400, error: "operation failed" };

  const purePointsOnly = Boolean(input.purePointsOnly);
  const product = {
    id: nextId("p"),
    name,
    category: typeof input.category === "string" && input.category.trim() ? input.category.trim() : purePointsOnly ? "points" : "fruit",
    cashPrice: purePointsOnly ? null : Math.max(0, roundMoney(input.cashPrice)),
    pointsPrice: Number.isFinite(Number(input.pointsPrice)) ? Math.max(0, Math.floor(Number(input.pointsPrice))) : 0,
    stock: Number.isFinite(Number(input.stock)) ? Math.max(0, Math.floor(Number(input.stock))) : 0,
    tag: typeof input.tag === "string" && input.tag.trim() ? input.tag.trim() : purePointsOnly ? "exchange" : "new",
    image: typeof input.image === "string" && input.image.trim() ? input.image.trim() : "/assets/apple.jpg",
    supportsCash: purePointsOnly ? false : input.supportsCash !== false,
    supportsPoints: true,
    purePointsOnly,
    status: input.status === "off" ? "off" : "on"
  };

  if (product.purePointsOnly) {
    product.cashPrice = null;
    product.supportsCash = false;
    product.supportsPoints = true;
  }

  state.products.unshift(product);
  inventoryRepository.addEntry(state, {
    product,
    changeType: "initial_stock",
    quantityDelta: Number(product.stock || 0),
    stockBefore: 0,
    stockAfter: Number(product.stock || 0),
    batchNo: input.batchNo,
      reason: input.reason || "admin operation",
    actor
  });
  logOperation(state, actor, "product.create", "product", product.id, { after: product });
  saveState();
  return { ok: true, product };
}

function listTaskSubmissions(state) {
  return state.submissions.map((submission) => {
    const task = taskRepository.findById(state, submission.taskId) || submission.taskSnapshot || {};
    const user = userRepository.findById(state, submission.userId);
    return {
      ...submission,
      taskTitle: task?.title || submission.taskId,
      rewardPoints: task?.rewardPoints || 0,
      userName: user?.nickname || submission.userId
    };
  });
}

function reviewTaskSubmission(state, submissionId, status, remarks, actor = {}) {
  const result = handleTaskCallback(state, { submissionId, status, remarks });
  if (!result.ok) return result;
  logOperation(state, actor, `task.${status}`, "task_submission", submissionId, { remarks });
  saveState();
  return result;
}

function approveWithdrawal(state, withdrawalId, actor = {}, reason = "") {
  const withdrawal = state.withdrawRequests.find((item) => item.id === withdrawalId);
  if (!withdrawal) return { ok: false, status: 404, error: "operation failed" };
  if (withdrawal.status !== "pending_review") return { ok: false, status: 400, error: "operation failed" };

  const now = new Date().toISOString();
  withdrawal.status = "success";
  withdrawal.updatedAt = now;
  ledgerRepository.addWithdrawableEntry(state, {
    id: nextId("wlg"),
    userId: withdrawal.userId,
    changeType: "withdraw_payout",
    direction: "out",
    amount: withdrawal.amount,
    balanceAfter: userRepository.findById(state, withdrawal.userId)?.withdrawableBalance || 0,
    bizNo: withdrawal.id,
    idempotencyKey: `${withdrawal.id}:payout`,
    createdAt: now
  });
  logOperation(state, actor, "withdrawal.approve", "withdrawal", withdrawal.id, { amount: withdrawal.amount, reason: cleanReason(reason) });
  saveState();
  return { ok: true, withdrawal };
}

function rejectWithdrawal(state, withdrawalId, reason, actor = {}) {
  const withdrawal = state.withdrawRequests.find((item) => item.id === withdrawalId);
  if (!withdrawal) return { ok: false, status: 404, error: "operation failed" };
  if (withdrawal.status !== "pending_review") return { ok: false, status: 400, error: "operation failed" };

  const user = userRepository.findById(state, withdrawal.userId);
  if (!user) return { ok: false, status: 400, error: "operation failed" };

  const now = new Date().toISOString();
  user.withdrawableBalance = roundMoney((user.withdrawableBalance || 0) + withdrawal.amount);
  withdrawal.status = "rejected";
  withdrawal.reason = reason || "";
  withdrawal.updatedAt = now;
  ledgerRepository.addWithdrawableEntry(state, {
    id: nextId("wlg"),
    userId: user.id,
    changeType: "withdraw_unfreeze",
    direction: "in",
    amount: withdrawal.amount,
    balanceAfter: user.withdrawableBalance,
    bizNo: withdrawal.id,
    idempotencyKey: `${withdrawal.id}:reject`,
    createdAt: now
  });
  logOperation(state, actor, "withdrawal.reject", "withdrawal", withdrawal.id, { reason });
  saveState();
  return { ok: true, withdrawal };
}

function listPickupSites(state) {
  return state.pickupSites;
}

function listDeliveryTeams(state) {
  return state.deliveryTeams.map((team) => ({
    ...team,
    staff: state.deliveryStaff.filter((staff) => staff.teamId === team.id)
  }));
}

function createPickupSite(state, input = {}, actor = {}) {
  const name = String(input.name || "").trim();
  const address = String(input.address || "").trim();
  if (!name || !address) return { ok: false, status: 400, error: "operation failed" };
  const site = {
    id: input.id || nextId("site"),
    name,
    address,
    contactName: String(input.contactName || "agent").trim(),
    contactPhone: String(input.contactPhone || "").trim(),
    enabled: input.enabled !== false,
    verifyMode: input.verifyMode || "pickup_code"
  };
  state.pickupSites.unshift(site);
  logOperation(state, actor, "pickup_site.create", "pickup_site", site.id, { after: site, reason: cleanReason(input.reason) });
  saveState();
  return { ok: true, site };
}

function updatePickupSite(state, siteId, input = {}, actor = {}) {
  const site = state.pickupSites.find((item) => item.id === siteId);
  if (!site) return { ok: false, status: 404, error: "operation failed" };
  const before = { ...site };
  for (const key of ["name", "address", "contactName", "contactPhone", "verifyMode"]) {
    if (typeof input[key] === "string" && input[key].trim()) site[key] = input[key].trim();
  }
  if (typeof input.enabled === "boolean") site.enabled = input.enabled;
  logOperation(state, actor, "pickup_site.update", "pickup_site", site.id, { before, after: site, reason: cleanReason(input.reason) });
  saveState();
  return { ok: true, site };
}

function createDeliveryTeam(state, input = {}, actor = {}) {
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, status: 400, error: "operation failed" };
  const team = {
    id: input.id || nextId("team"),
    name,
    serviceArea: String(input.serviceArea || "campus 5km").trim(),
    enabled: input.enabled !== false
  };
  state.deliveryTeams.unshift(team);
  logOperation(state, actor, "delivery_team.create", "delivery_team", team.id, { after: team, reason: cleanReason(input.reason) });
  saveState();
  return { ok: true, team };
}

function updateDeliveryTeam(state, teamId, input = {}, actor = {}) {
  const team = state.deliveryTeams.find((item) => item.id === teamId);
  if (!team) return { ok: false, status: 404, error: "operation failed" };
  const before = { ...team };
  for (const key of ["name", "serviceArea"]) {
    if (typeof input[key] === "string" && input[key].trim()) team[key] = input[key].trim();
  }
  if (typeof input.enabled === "boolean") team.enabled = input.enabled;
  logOperation(state, actor, "delivery_team.update", "delivery_team", team.id, { before, after: team, reason: cleanReason(input.reason) });
  saveState();
  return { ok: true, team };
}

function listOrderStatusLogs(state) {
  return state.orderStatusLogs;
}

function listOperationLogs(state) {
  return state.adminOperationLogs;
}

function listApprovalRequests(state) {
  return state.adminApprovalRequests || [];
}

function requestApproval(state, input, actor = {}) {
  const action = String(input.action || "");
  const targetType = String(input.targetType || "");
  const targetId = String(input.targetId || "");
  const reason = cleanReason(input.reason);
  if (!action || !targetType || !targetId) return { ok: false, status: 400, error: "operation failed" };
  if (!isSupportedApprovalAction(action, targetType)) return { ok: false, status: 400, error: "operation failed" };

  const targetCheck = assertApprovalTarget(state, action, targetId, input);
  if (!targetCheck.ok) return targetCheck;

  const existing = (state.adminApprovalRequests || []).find((item) => item.action === action && item.targetId === targetId && item.status === "pending");
  if (existing) return { ok: true, approvalRequest: existing, idempotent: true };
  const idempotencyKey = input.idempotencyKey || `approval:${action}:${targetId}:${Date.now()}`;

  const now = new Date().toISOString();
  const approvalRequest = {
    id: nextId("apr"),
    requestType: "sensitive_operation",
    action,
    targetType,
    targetId,
    status: "pending",
    requestReason: reason,
    reviewReason: "",
    requestedByRoleId: actor.role?.id || actor.id || "unknown",
    reviewedByRoleId: "",
    payload: { ...(input.payload || {}), ...(targetCheck.payload || {}), reason, targetSnapshot: clonePlain(targetCheck.target) },
    result: {},
    idempotencyKey,
    createdAt: now,
    updatedAt: now
  };
  state.adminApprovalRequests ||= [];
  state.adminApprovalRequests.unshift(approvalRequest);
  logOperation(state, actor, "approval.request", "approval", approvalRequest.id, {
    action,
    targetType,
    targetId,
    reason
  });
  saveState();
  return { ok: true, approvalRequest };
}

function approveRefundOrder(state, refundId, actor = {}, reason = "") {
  const result = approveRefund(state, refundId);
  if (result.ok) {
    logOperation(state, actor, "refund.approve", "refund", refundId, {
      orderId: result.refundOrder?.orderId,
      refundCashAmount: result.refundOrder?.refundCashAmount || 0,
      refundPointAmount: result.refundOrder?.refundPointAmount || 0,
      idempotent: Boolean(result.idempotent),
      reason: cleanReason(reason)
    });
    saveState();
  }
  return result;
}

function approveApprovalRequest(state, approvalId, actor = {}, reason = "") {
  const approvalRequest = findApprovalRequest(state, approvalId);
  if (!approvalRequest) return { ok: false, status: 404, error: "operation failed" };
  if (approvalRequest.status !== "pending") return { ok: false, status: 400, error: "operation failed" };
  const reviewerRoleId = actor.role?.id || actor.id || "unknown";
  if (reviewerRoleId === approvalRequest.requestedByRoleId && !hasWildcardPermission(actor)) {
    return { ok: false, status: 400, error: "operation failed" };
  }

  const result = executeApprovalRequest(state, approvalRequest, actor, reason || approvalRequest.requestReason);
  approvalRequest.reviewedByRoleId = reviewerRoleId;
  approvalRequest.reviewReason = cleanReason(reason);
  approvalRequest.updatedAt = new Date().toISOString();
  approvalRequest.result = result.ok ? serializeApprovalResult(result) : { error: result.error };
  approvalRequest.status = result.ok ? "executed" : "failed";
  logOperation(state, actor, result.ok ? "approval.execute" : "approval.failed", "approval", approvalRequest.id, {
    action: approvalRequest.action,
    targetType: approvalRequest.targetType,
    targetId: approvalRequest.targetId,
    resultStatus: approvalRequest.status,
    reason: cleanReason(reason)
  });
  saveState();
  return result.ok ? { ok: true, approvalRequest, result } : { ...result, approvalRequest };
}

function rejectApprovalRequest(state, approvalId, actor = {}, reason = "") {
  const approvalRequest = findApprovalRequest(state, approvalId);
  if (!approvalRequest) return { ok: false, status: 404, error: "operation failed" };
  if (approvalRequest.status !== "pending") return { ok: false, status: 400, error: "operation failed" };
  approvalRequest.status = "rejected";
  approvalRequest.reviewedByRoleId = actor.role?.id || actor.id || "unknown";
  approvalRequest.reviewReason = cleanReason(reason);
  approvalRequest.updatedAt = new Date().toISOString();
  logOperation(state, actor, "approval.reject", "approval", approvalRequest.id, {
    action: approvalRequest.action,
    targetType: approvalRequest.targetType,
    targetId: approvalRequest.targetId,
    reason: cleanReason(reason)
  });
  saveState();
  return { ok: true, approvalRequest };
}

function verifyPickupOrder(state, orderId, pickupCode, actor = {}, reason = "") {
  const result = verifyPickup(state, orderId, pickupCode);
  if (result.ok) {
    logOperation(state, actor, "order.pickup_verify", "order", orderId, {
      pickupCodeVerified: true,
      idempotent: Boolean(result.idempotent),
      reason: cleanReason(reason)
    });
    saveState();
  }
  return result;
}

function shipDeliveryOrder(state, orderId, staffId, actor = {}, reason = "") {
  const result = shipOrder(state, orderId, staffId);
  if (result.ok) {
    logOperation(state, actor, "order.ship", "order", orderId, {
      staffId: staffId || null,
      staffName: result.order?.deliveryStaffSnapshot?.name || "",
      idempotent: Boolean(result.idempotent),
      reason: cleanReason(reason)
    });
    saveState();
  }
  return result;
}

function completeDeliveryOrder(state, orderId, actor = {}, reason = "") {
  const result = deliverOrder(state, orderId);
  if (result.ok) {
    logOperation(state, actor, "order.deliver", "order", orderId, {
      completedAt: result.order?.completedAt || "",
      idempotent: Boolean(result.idempotent),
      reason: cleanReason(reason)
    });
    saveState();
  }
  return result;
}

function scanDeliveryExceptions(state, input = {}, actor = {}) {
  const timeoutMinutes = Math.max(1, Number(input.timeoutMinutes || state.config?.deliveryTimeoutMinutes || 180));
  const now = new Date(input.now || Date.now());
  const cutoff = now.getTime() - timeoutMinutes * 60 * 1000;
  const exceptions = [];

  for (const order of state.orders || []) {
    if (order.fulfillmentType !== "delivery" || order.fulfillmentStatus !== "shipping" || order.status !== "paid") continue;
    const shippedAt = new Date(order.shippedAt || order.createdAt || now).getTime();
    if (!Number.isFinite(shippedAt) || shippedAt > cutoff) continue;
    const exception = createDeliveryException(state, order, "delivery_timeout", "delivery timeout pending dispatch follow-up", {
      timeoutMinutes,
      shippedAt: order.shippedAt || order.createdAt || "",
      deliveryStaffId: order.deliveryStaffId || "",
      deliveryAddress: order.deliveryAddress || ""
    });
    if (exception) exceptions.push(exception);
  }

  logOperation(state, actor, "delivery.scan_exceptions", "delivery", "timeout_batch", {
    timeoutMinutes,
    exceptionCount: exceptions.length,
    orderIds: exceptions.map((item) => item.payload?.orderId).filter(Boolean),
    reason: cleanReason(input.reason)
  });
  saveState();
  return { ok: true, timeoutMinutes, exceptions };
}

function createExceptionRecord(state, input) {
  return createException(state, input);
}

function resolveExceptionRecord(state, exceptionId, action, actor = {}, reason = "") {
  const result = resolveException(state, exceptionId, action);
  if (result.ok) {
    logOperation(state, actor, "exception.resolve", "exception", exceptionId, {
      action,
      bizNo: result.exception?.bizNo || "",
      exceptionType: result.exception?.type || "",
      reason: cleanReason(reason)
    });
    saveState();
  }
  return result;
}

function logPaymentTimeoutCancellation(state, actor = {}, result = {}, reason = "") {
  logOperation(state, actor, "payment.cancel_timeouts", "payment", "timeout_batch", {
    timeoutMinutes: result.timeoutMinutes,
    cancelledCount: result.cancelled?.length || 0,
    paymentIds: (result.cancelled || []).map((item) => item.id),
    reason: cleanReason(reason)
  });
  saveState();
}

function findApprovalRequest(state, approvalId) {
  return (state.adminApprovalRequests || []).find((item) => item.id === approvalId);
}

function isSupportedApprovalAction(action, targetType) {
  return (
    (action === "refund.approve" && targetType === "refund") ||
    (["withdrawal.approve", "withdrawal.reject"].includes(action) && targetType === "withdrawal") ||
    (action === "points.adjust" && targetType === "user") ||
    (action === "monthly_reward.reverse" && targetType === "monthly_reward")
  );
}

function assertApprovalTarget(state, action, targetId, input = {}) {
  if (action === "refund.approve") {
    const target = refundRepository.findById(state, targetId);
    if (!target) return { ok: false, status: 404, error: "operation failed" };
    if (target.status !== "pending_review") return { ok: false, status: 400, error: "operation failed" };
    return { ok: true, target };
  }
  if (action === "points.adjust") {
    const target = userRepository.findById(state, targetId);
    if (!target) return { ok: false, status: 404, error: "operation failed" };
    const pointsDelta = Math.trunc(Number(input.payload?.pointsDelta ?? input.pointsDelta));
    if (!Number.isFinite(pointsDelta) || pointsDelta === 0) return { ok: false, status: 400, error: "operation failed" };
    if (Number(target.points || 0) + pointsDelta < 0) return { ok: false, status: 400, error: "operation failed" };
    return { ok: true, target, payload: { pointsDelta } };
  }
  if (action === "monthly_reward.reverse") {
    const target = (state.monthlyPointRewardSettlements || []).find((item) => item.id === targetId);
    if (!target) return { ok: false, status: 404, error: "operation failed" };
    if (target.reversedAt) return { ok: false, status: 400, error: "operation failed" };
    const user = userRepository.findById(state, target.userId);
    if (!user) return { ok: false, status: 404, error: "operation failed" };
    if (Number(user.points || 0) < Number(target.rewardPoints || 0)) return { ok: false, status: 409, error: "operation failed" };
    return { ok: true, target, payload: { settlementId: target.id, userId: target.userId } };
  }
  if (["withdrawal.approve", "withdrawal.reject"].includes(action)) {
    const target = state.withdrawRequests.find((item) => item.id === targetId);
    if (!target) return { ok: false, status: 404, error: "operation failed" };
    if (target.status !== "pending_review") return { ok: false, status: 400, error: "operation failed" };
    return { ok: true, target };
  }
  return { ok: false, status: 400, error: "operation failed" };
}

function executeApprovalRequest(state, approvalRequest, actor, reason) {
  if (approvalRequest.action === "refund.approve") {
    return approveRefundOrder(state, approvalRequest.targetId, actor, reason);
  }
  if (approvalRequest.action === "withdrawal.approve") {
    return approveWithdrawal(state, approvalRequest.targetId, actor, reason);
  }
  if (approvalRequest.action === "withdrawal.reject") {
    return rejectWithdrawal(state, approvalRequest.targetId, reason, actor);
  }
  if (approvalRequest.action === "points.adjust") {
    return adjustUserPoints(state, approvalRequest.targetId, approvalRequest.payload, actor, reason, approvalRequest.id);
  }
  if (approvalRequest.action === "monthly_reward.reverse") {
    return reverseMonthlyPointRewardSettlement(state, approvalRequest.targetId, {
      reason,
      actor
    });
  }
  return { ok: false, status: 400, error: "operation failed" };
}

function adjustUserPoints(state, userId, input = {}, actor = {}, reason = "", approvalId = "") {
  const user = userRepository.findById(state, userId);
  if (!user) return { ok: false, status: 404, error: "operation failed" };
  const pointsDelta = Math.trunc(Number(input.pointsDelta));
  if (!Number.isFinite(pointsDelta) || pointsDelta === 0) return { ok: false, status: 400, error: "operation failed" };
  const beforePoints = Number(user.points || 0);
  const afterPoints = beforePoints + pointsDelta;
  if (afterPoints < 0) return { ok: false, status: 400, error: "operation failed" };

  const idempotencyKey = `approval:${approvalId || "manual"}:points_adjust`;
  const existing = state.pointLedger.find((entry) => entry.idempotencyKey === idempotencyKey);
  if (existing) return { ok: true, user, idempotent: true };

  user.points = afterPoints;
  ledgerRepository.addPointEntry(state, {
    id: nextId("pt"),
    userId: user.id,
    changeType: "manual_adjust",
    direction: pointsDelta > 0 ? "in" : "out",
    points: Math.abs(pointsDelta),
    balanceAfter: user.points,
    bizNo: approvalId || `manual:${user.id}`,
    idempotencyKey,
    createdAt: new Date().toISOString()
  });
  logOperation(state, actor, "points.adjust", "user", user.id, {
    beforePoints,
    afterPoints,
    pointsDelta,
    approvalId,
    reason: cleanReason(reason || input.reason)
  });
  saveState();
  return { ok: true, user };
}

function serializeApprovalResult(result) {
  return {
    refundOrder: result.refundOrder ? { id: result.refundOrder.id, status: result.refundOrder.status } : undefined,
    withdrawal: result.withdrawal ? { id: result.withdrawal.id, status: result.withdrawal.status } : undefined,
    user: result.user ? { id: result.user.id, points: result.user.points, status: result.user.status } : undefined,
    idempotent: Boolean(result.idempotent)
  };
}

function hasWildcardPermission(actor) {
  return Boolean(actor.role?.permissions?.includes("*") || actor.permissions?.includes("*"));
}

function logOperation(state, actor, action, targetType, targetId, payload = {}) {
  const reason = cleanReason(payload.reason || payload.remarks || payload.after?.reason);
  const after = payload.after ? { ...payload.after, reason } : { ...payload, reason };
  state.adminOperationLogs.unshift({
    id: nextId("op"),
    adminId: actor.adminId || null,
    roleId: actor.role?.id || actor.id || "unknown",
    action,
    targetType,
    targetId,
    reason,
    detail: payload,
    idempotencyKey: payload.idempotencyKey || payload.after?.idempotencyKey || "",
    before: payload.before || {},
    after,
    createdAt: new Date().toISOString()
  });
}

function cleanReason(reason) {
  return typeof reason === "string" ? reason.trim() : "";
}

function getMonthlyPointRewardOverview(state, options = {}) {
  return buildMonthlyPointRewardOverview(state, options);
}

function settleMonthlyPointRewardBatch(state, options = {}, actor = {}) {
  return settleMonthlyPointRewards(state, { ...options, actor });
}

function reverseMonthlyPointRewardSettlement(state, settlementId, options = {}, actor = {}) {
  return reverseMonthlyPointReward(state, settlementId, { ...options, actor });
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = {
  getAdminIdentity,
  requirePermission,
  getSummary,
  getLedger,
  listRoles,
  listDashboardViews,
  listExceptions,
  listRefunds,
  listWithdrawals,
  listUsers,
  listAddresses,
  listInviteAudits,
  listInventoryLedger,
  updateUser,
  listTickets,
  updateTicket,
  updateConfig,
  createProduct,
  updateProduct,
  listTaskSubmissions,
  reviewTaskSubmission,
  approveWithdrawal,
  rejectWithdrawal,
  listPickupSites,
  listDeliveryTeams,
  createPickupSite,
  updatePickupSite,
  createDeliveryTeam,
  updateDeliveryTeam,
  listOrderStatusLogs,
  listOperationLogs,
  listApprovalRequests,
  saveDashboardViews,
  requestApproval,
  approveApprovalRequest,
  rejectApprovalRequest,
  approveRefundOrder,
  verifyPickupOrder,
  shipDeliveryOrder,
  completeDeliveryOrder,
  scanDeliveryExceptions,
  createExceptionRecord,
  resolveExceptionRecord,
  logPaymentTimeoutCancellation,
  getMonthlyPointRewardOverview,
  settleMonthlyPointRewardBatch,
  reverseMonthlyPointRewardSettlement
};
