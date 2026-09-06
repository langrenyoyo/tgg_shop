import { api, getAdminRole, safeApi } from "./api.js";
import { renderAdminPage } from "./render.js";

const state = {
  view: "dashboard",
  summary: {},
  orders: [],
  products: [],
  inventoryLedger: [],
  ledger: { pointLedger: [], paymentLedger: [] },
  roles: [],
  refunds: [],
  exceptions: [],
  config: {},
  monthlyPointRewardOverview: {},
  monthlyRewardFilters: {
    monthKey: "",
    threshold: "all",
    settled: "all"
  },
  pickupSites: [],
  deliveryTeams: [],
  withdrawals: [],
  users: [],
  addresses: [],
  invites: [],
  tickets: [],
  ranking: null,
  approvalRequests: [],
  orderStatusLogs: [],
  operationLogs: [],
  taskSubmissions: [],
  dashboardFilters: {
    range: "month",
    orderStatus: "all",
    fulfillmentStatus: "all",
    paymentMode: "all",
    payScene: "all",
    startDate: "",
    endDate: ""
  },
  paymentFilters: {
    paymentStatus: "",
    payScene: "",
    channel: ""
  },
  dashboardViews: [],
  dashboardBatchSelection: {
    refunds: [],
    exceptions: []
  },
  dashboardQueueFilters: {
    exceptionType: "all",
    refundType: "all"
  },
  dashboardBatchMessage: "",
  paymentActionMessage: "",
  identity: null,
  role: getAdminRole()
};

async function loadDashboard() {
  const summaryPath = buildSummaryPath();
  const monthlyRewardPath = buildMonthlyRewardPath();
  const [identity, summary, orders, products, inventoryLedger, ledger, roles, refunds, exceptions, config, monthlyPointRewardOverview, pickupSites, deliveryTeams, withdrawals, users, addresses, invites, tickets, ranking, approvalRequests, orderStatusLogs, operationLogs, taskSubmissions, dashboardViews] = await Promise.all([
    safeApi("/api/admin/auth/me", null),
    safeApi(summaryPath, {}),
    safeApi("/api/admin/orders", []),
    safeApi("/api/admin/products", []),
    safeApi("/api/admin/inventory-ledger", []),
    safeApi(paymentLedgerPath(), { pointLedger: [], paymentLedger: [] }),
    safeApi("/api/admin/permissions", []),
    safeApi("/api/admin/refunds", []),
    safeApi("/api/admin/exceptions", []),
    safeApi("/api/admin/config", {}),
    safeApi(monthlyRewardPath, {}),
    safeApi("/api/admin/pickup-sites", []),
    safeApi("/api/admin/delivery-teams", []),
    safeApi("/api/admin/withdrawals", []),
    safeApi("/api/admin/users", []),
    safeApi("/api/admin/addresses", []),
    safeApi("/api/admin/invites", []),
    safeApi("/api/admin/tickets", []),
    safeApi("/api/ranking", null),
    safeApi("/api/admin/approval-requests", []),
    safeApi("/api/admin/order-status-logs", []),
    safeApi("/api/admin/operation-logs", []),
    safeApi("/api/admin/task-submissions", []),
    safeApi("/api/admin/dashboard-views", [])
  ]);

  state.identity = identity.ok ? identity.data : null;
  state.summary = summary.ok ? summary.data : { role: state.role };
  state.orders = orders.ok ? orders.data : [];
  state.products = products.ok ? products.data : [];
  state.inventoryLedger = inventoryLedger.ok ? inventoryLedger.data : [];
  state.ledger = ledger.ok ? ledger.data : { pointLedger: [], paymentLedger: [] };
  state.roles = roles.ok ? roles.data : [];
  state.refunds = refunds.ok ? refunds.data : [];
  state.exceptions = exceptions.ok ? exceptions.data : [];
  state.config = config.ok ? config.data : {};
  state.monthlyPointRewardOverview = monthlyPointRewardOverview.ok ? monthlyPointRewardOverview.data : {};
  state.pickupSites = pickupSites.ok ? pickupSites.data : [];
  state.deliveryTeams = deliveryTeams.ok ? deliveryTeams.data : [];
  state.withdrawals = withdrawals.ok ? withdrawals.data : [];
  state.users = users.ok ? users.data : [];
  state.addresses = addresses.ok ? addresses.data : [];
  state.invites = invites.ok ? invites.data : [];
  state.tickets = tickets.ok ? tickets.data : [];
  state.ranking = ranking.ok ? ranking.data : null;
  state.approvalRequests = approvalRequests.ok ? approvalRequests.data : [];
  state.orderStatusLogs = orderStatusLogs.ok ? orderStatusLogs.data : [];
  state.operationLogs = operationLogs.ok ? operationLogs.data : [];
  state.taskSubmissions = taskSubmissions.ok ? taskSubmissions.data : [];
  state.dashboardViews = dashboardViews.ok ? dashboardViews.data : [];
  renderAdminPage(state);
}

function paymentLedgerPath() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.paymentFilters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/api/admin/ledger?${query}` : "/api/admin/ledger";
}

function buildSummaryPath() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.dashboardFilters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/api/admin/summary?${query}` : "/api/admin/summary";
}

function buildMonthlyRewardPath() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.monthlyRewardFilters)) {
    if (value && value !== "all") params.set(key, value);
  }
  const query = params.toString();
  return query ? `/api/admin/monthly-point-rewards?${query}` : "/api/admin/monthly-point-rewards";
}

function persistDashboardViews(reason = "保存仪表盘视图") {
  return api("/api/admin/dashboard-views", {
    method: "PUT",
    body: JSON.stringify({ views: state.dashboardViews || [], reason })
  }).then((result) => {
    state.dashboardViews = result.views || [];
    renderAdminPage(state);
  });
}

function setDashboardFilter(key, value) {
  if (key === "range") {
    state.dashboardFilters[key] = value || "month";
    state.dashboardFilters.startDate = "";
    state.dashboardFilters.endDate = "";
  } else if (value === "all") {
    state.dashboardFilters[key] = "all";
  } else {
    state.dashboardFilters[key] = state.dashboardFilters[key] === value ? "all" : value;
  }
  if (key === "range" && !state.dashboardFilters[key]) state.dashboardFilters[key] = "month";
  loadDashboard().catch(() => renderAdminPage(state));
}

function setPaymentFilter(key, value) {
  state.paymentFilters[key] = state.paymentFilters[key] === value ? "" : value;
  loadDashboard().catch(() => renderAdminPage(state));
}

function setMonthlyRewardFilter(key, value) {
  if (key === "monthKey") {
    state.monthlyRewardFilters.monthKey = value || "";
  } else if (value === "all") {
    state.monthlyRewardFilters[key] = "all";
  } else {
    state.monthlyRewardFilters[key] = state.monthlyRewardFilters[key] === value ? "all" : value;
  }
  loadDashboard().catch(() => renderAdminPage(state));
}

function applyDashboardView(view) {
  if (!view?.filters) return;
  const viewId = view.id;
  const nextViews = (state.dashboardViews || []).map((item) => (
    item.id === viewId
      ? { ...item, lastUsedAt: Date.now() }
      : item
  ));
  nextViews.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0));
  state.dashboardViews = nextViews;
  state.dashboardFilters = {
    ...state.dashboardFilters,
    ...view.filters
  };
  state.dashboardQueueFilters = {
    ...state.dashboardQueueFilters,
    ...(view.queueFilters || {})
  };
  persistDashboardViews("应用仪表盘视图")
    .then(() => loadDashboard())
    .then(() => document.getElementById("dashboard-orders")?.scrollIntoView({ behavior: "smooth", block: "start" }))
    .catch(() => renderAdminPage(state));
}

function saveDashboardView() {
  const name = window.prompt("保存当前仪表盘视图名称", "本周异常待办");
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const nextViews = [
    {
      id: `view_${Date.now()}`,
      name: trimmed,
      filters: { ...state.dashboardFilters },
      queueFilters: { ...state.dashboardQueueFilters },
      lastUsedAt: Date.now(),
      pinned: false
    },
    ...(state.dashboardViews || []).filter((item) => item.name !== trimmed)
  ].slice(0, 8);
  state.dashboardViews = nextViews;
  persistDashboardViews("保存仪表盘视图").catch(() => renderAdminPage(state));
}

function removeDashboardView(viewId) {
  state.dashboardViews = (state.dashboardViews || []).filter((item) => item.id !== viewId);
  persistDashboardViews("删除仪表盘视图").catch(() => renderAdminPage(state));
}

function toggleDashboardViewPin(viewId) {
  state.dashboardViews = (state.dashboardViews || []).map((item) => (
    item.id === viewId ? { ...item, pinned: !item.pinned, lastUsedAt: Date.now() } : item
  ));
  state.dashboardViews.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0));
  persistDashboardViews("切换仪表盘置顶").catch(() => renderAdminPage(state));
}

function toggleDashboardBatchSelection(kind, id) {
  const current = new Set(state.dashboardBatchSelection[kind] || []);
  if (current.has(id)) current.delete(id);
  else current.add(id);
  state.dashboardBatchSelection[kind] = [...current];
  renderAdminPage(state);
}

function setDashboardBatchSelection(kind, ids) {
  state.dashboardBatchSelection[kind] = [...new Set(ids)];
  renderAdminPage(state);
}

function setDashboardQueueFilter(key, value) {
  const nextValue = state.dashboardQueueFilters[key] === value ? "all" : value;
  state.dashboardQueueFilters[key] = nextValue;
  if (key === "exceptionType" || key === "refundType") {
    state.dashboardBatchSelection.refunds = [];
    state.dashboardBatchSelection.exceptions = [];
  }
  renderAdminPage(state);
}

async function runDashboardBatch(kind, action) {
  const selection = state.dashboardBatchSelection[kind] || [];
  if (!selection.length) return;
  const confirmation = requestSensitiveReason(
    kind === "refunds" ? "批量提交退款复核" : "批量处理异常",
    kind === "refunds"
      ? `将提交 ${selection.length} 笔退款进入二级审批队列。`
      : `将标记 ${selection.length} 条异常为已处理。`,
    kind === "refunds" ? "批量提交退款复核" : "批量标记异常补偿"
  );
  if (!confirmation.ok) return;
  const results = [];
  if (kind === "refunds") {
    const settled = await Promise.allSettled(selection.map((refundId) => api("/api/admin/approval-requests", {
      method: "POST",
      body: JSON.stringify({
        action: "refund.approve",
        targetType: "refund",
        targetId: refundId,
        reason: confirmation.reason
      })
    })));
    results.push(...settled);
  } else if (kind === "exceptions") {
    const settled = await Promise.allSettled(selection.map((exceptionId) => api(`/api/admin/exceptions/${exceptionId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, reason: confirmation.reason })
    })));
    results.push(...settled);
  }
  state.dashboardBatchSelection[kind] = [];
  const successCount = results.filter((item) => item.status === "fulfilled").length;
  const failedCount = results.length - successCount;
  state.dashboardBatchMessage = failedCount
    ? `已处理当前筛选队列：成功 ${successCount}，失败 ${failedCount}`
    : `已处理当前筛选队列：成功 ${successCount}`;
  await loadDashboard().catch(() => renderAdminPage(state));
}

function setView(view) {
  state.view = view;
  renderAdminPage(state);
}

function confirmSensitiveAction({ title, message, defaultReason = "后台敏感操作确认", reasonRequired = true }) {
  const confirmed = window.confirm(`${title}\n\n${message || "该操作会写入后台操作日志，请确认继续。"}`);
  if (!confirmed) return { ok: false };

  const reason = window.prompt("请输入操作原因（会写入操作日志）", defaultReason);
  if (reason === null) return { ok: false };
  if (reasonRequired && !reason.trim()) {
    window.alert("敏感操作必须填写操作原因。");
    return { ok: false };
  }
  return { ok: true, reason: reason.trim() || defaultReason };
}

function requestSensitiveReason(title, message, defaultReason) {
  return confirmSensitiveAction({ title, message, defaultReason });
}

document.querySelector("#adminNav").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  setView(button.dataset.view);
});

document.querySelector("#refresh").addEventListener("click", () => {
  loadDashboard().catch(() => renderAdminPage(state));
});

document.body.addEventListener("click", (event) => {
  const monthlyRewardSettle = event.target.closest("[data-monthly-point-reward-settle]");
  if (monthlyRewardSettle) {
    api("/api/admin/monthly-point-rewards/settle", {
      method: "POST",
      body: JSON.stringify({ reason: "后台手动结算上月奖励积分" })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const monthlyRewardReverse = event.target.closest("[data-monthly-point-reward-reverse-request]");
  if (monthlyRewardReverse) {
    const settlementId = monthlyRewardReverse.dataset.monthlyPointRewardReverseRequest;
    const confirmation = requestSensitiveReason("提交月度奖励复核", `结算记录 ${settlementId} 将进入二级复核队列，复核通过后执行追回。`, "月度奖励复核申请");
    if (!confirmation.ok) return;
    api("/api/admin/approval-requests", {
      method: "POST",
      body: JSON.stringify({
        action: "monthly_reward.reverse",
        targetType: "monthly_reward",
        targetId: settlementId,
        reason: confirmation.reason
      })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const dashboardJump = event.target.closest("[data-dashboard-jump]");
  if (dashboardJump) {
    const target = document.getElementById(dashboardJump.dataset.dashboardJump);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const dashboardFilter = event.target.closest("[data-dashboard-filter]");
  if (dashboardFilter) {
    setDashboardFilter(dashboardFilter.dataset.filterKey, dashboardFilter.dataset.filterValue);
    return;
  }

  const monthlyRewardFilter = event.target.closest("[data-monthly-reward-filter]");
  if (monthlyRewardFilter) {
    setMonthlyRewardFilter(monthlyRewardFilter.dataset.filterKey, monthlyRewardFilter.dataset.filterValue);
    return;
  }

  const dashboardDrill = event.target.closest("[data-dashboard-drill]");
  if (dashboardDrill) {
    state.dashboardFilters[dashboardDrill.dataset.filterKey] = dashboardDrill.dataset.filterValue;
    loadDashboard()
      .then(() => document.getElementById("dashboard-orders")?.scrollIntoView({ behavior: "smooth", block: "start" }))
      .catch(() => renderAdminPage(state));
    return;
  }

  const dashboardAlert = event.target.closest("[data-dashboard-alert-drill]");
  if (dashboardAlert) {
    let payload = {};
    try {
      payload = JSON.parse(dashboardAlert.dataset.dashboardAlertDrill || "{}");
    } catch {
      payload = {};
    }
    state.dashboardFilters = { ...state.dashboardFilters, ...payload };
    loadDashboard()
      .then(() => document.getElementById("dashboard-orders")?.scrollIntoView({ behavior: "smooth", block: "start" }))
      .catch(() => renderAdminPage(state));
    return;
  }

  const dashboardViewApply = event.target.closest("[data-dashboard-view-apply]");
  if (dashboardViewApply) {
    const view = (state.dashboardViews || []).find((item) => item.id === dashboardViewApply.dataset.dashboardViewApply);
    applyDashboardView(view);
    return;
  }

  const dashboardViewDelete = event.target.closest("[data-dashboard-view-delete]");
  if (dashboardViewDelete) {
    removeDashboardView(dashboardViewDelete.dataset.dashboardViewDelete);
    return;
  }

  const dashboardViewPin = event.target.closest("[data-dashboard-view-pin]");
  if (dashboardViewPin) {
    toggleDashboardViewPin(dashboardViewPin.dataset.dashboardViewPin);
    return;
  }

  const dashboardBatchToggle = event.target.closest("[data-dashboard-batch-toggle]");
  if (dashboardBatchToggle) {
    toggleDashboardBatchSelection(dashboardBatchToggle.dataset.dashboardBatchKind, dashboardBatchToggle.dataset.dashboardBatchToggle);
    return;
  }

  const dashboardBatchSelectAll = event.target.closest("[data-dashboard-batch-select-all]");
  if (dashboardBatchSelectAll) {
    const kind = dashboardBatchSelectAll.dataset.dashboardBatchSelectAll;
    const ids = dashboardBatchSelectAll.dataset.dashboardBatchIds ? JSON.parse(dashboardBatchSelectAll.dataset.dashboardBatchIds) : [];
    setDashboardBatchSelection(kind, ids);
    return;
  }

  const dashboardBatchClear = event.target.closest("[data-dashboard-batch-clear]");
  if (dashboardBatchClear) {
    state.dashboardBatchSelection[dashboardBatchClear.dataset.dashboardBatchClear] = [];
    renderAdminPage(state);
    return;
  }

  const dashboardBatchRun = event.target.closest("[data-dashboard-batch-run]");
  if (dashboardBatchRun) {
    runDashboardBatch(dashboardBatchRun.dataset.dashboardBatchRun, dashboardBatchRun.dataset.batchAction || "manual_compensation").catch(() => renderAdminPage(state));
    return;
  }

  const dashboardQueueFilter = event.target.closest("[data-dashboard-queue-filter]");
  if (dashboardQueueFilter) {
    setDashboardQueueFilter(dashboardQueueFilter.dataset.dashboardQueueKey, dashboardQueueFilter.dataset.dashboardQueueFilter);
    return;
  }

  const dashboardRangeReset = event.target.closest("[data-dashboard-range-reset]");
  if (dashboardRangeReset) {
    state.dashboardFilters.range = "month";
    state.dashboardFilters.startDate = "";
    state.dashboardFilters.endDate = "";
    loadDashboard().catch(() => renderAdminPage(state));
    return;
  }

  const dashboardExport = event.target.closest("[data-dashboard-export]");
  if (dashboardExport) {
    if (dashboardExport.dataset.dashboardExport === "csv") exportDashboardCsv();
    else exportDashboardSnapshot();
    return;
  }

  const dashboardSaveView = event.target.closest("[data-dashboard-save-view]");
  if (dashboardSaveView) {
    saveDashboardView();
    return;
  }

  const pickupVerify = event.target.closest("[data-order-pickup-verify]");
  if (pickupVerify) {
    const pickupCode = window.prompt("请输入用户自提核销码", pickupVerify.dataset.pickupCode || "");
    if (!pickupCode) return;
    const confirmation = requestSensitiveReason("确认核销自提码", `订单 ${pickupVerify.dataset.orderPickupVerify} 将被标记为已自提/已完成。`, "用户到店自提，核销码验证通过");
    if (!confirmation.ok) return;
    api(`/api/admin/orders/${pickupVerify.dataset.orderPickupVerify}/pickup-verify`, {
      method: "POST",
      body: JSON.stringify({ pickupCode, reason: confirmation.reason })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const shipOrder = event.target.closest("[data-order-ship]");
  if (shipOrder) {
    const confirmation = requestSensitiveReason("确认配送发货", `订单 ${shipOrder.dataset.orderShip} 将分配给自建配送团队并进入配送中。`, "自建配送团队接单发货");
    if (!confirmation.ok) return;
    api(`/api/admin/orders/${shipOrder.dataset.orderShip}/ship`, {
      method: "POST",
      body: JSON.stringify({ staffId: shipOrder.dataset.staffId || "staff_001", reason: confirmation.reason })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const deliverOrder = event.target.closest("[data-order-deliver]");
  if (deliverOrder) {
    const confirmation = requestSensitiveReason("确认订单送达", `订单 ${deliverOrder.dataset.orderDeliver} 将完成履约并标记完成。`, "配送员反馈已送达");
    if (!confirmation.ok) return;
    api(`/api/admin/orders/${deliverOrder.dataset.orderDeliver}/deliver`, { method: "POST", body: JSON.stringify({ reason: confirmation.reason }) })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const approveRefund = event.target.closest("[data-refund-approve]");
  if (approveRefund) {
    const confirmation = requestSensitiveReason("提交退款复核", `退款单 ${approveRefund.dataset.refundApprove} 将进入二级审批队列，复核通过后才原路退款。`, "提交退款复核");
    if (!confirmation.ok) return;
    api("/api/admin/approval-requests", {
      method: "POST",
      body: JSON.stringify({
        action: "refund.approve",
        targetType: "refund",
        targetId: approveRefund.dataset.refundApprove,
        reason: confirmation.reason
      })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const resolveException = event.target.closest("[data-exception-resolve]");
  if (resolveException) {
    const action = resolveException.dataset.action || "manual_compensation";
    const confirmation = requestSensitiveReason("确认异常补偿完成", `异常单 ${resolveException.dataset.exceptionResolve} 将被标记为已处理。`, "人工确认补偿已完成");
    if (!confirmation.ok) return;
    api(`/api/admin/exceptions/${resolveException.dataset.exceptionResolve}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, reason: confirmation.reason })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const productAction = event.target.closest("[data-product-action]");
  if (productAction) {
    const body = {};
    if (productAction.dataset.status) body.status = productAction.dataset.status;
    if (productAction.dataset.stock !== undefined) body.stock = Number(productAction.dataset.stock);
    if (productAction.dataset.pointsPrice !== undefined) body.pointsPrice = Number(productAction.dataset.pointsPrice);
    if (productAction.dataset.cashPrice !== undefined) body.cashPrice = Number(productAction.dataset.cashPrice);
    if (productAction.dataset.supportsCash !== undefined) body.supportsCash = productAction.dataset.supportsCash === "true";
    if (productAction.dataset.inventoryChangeType) body.inventoryChangeType = productAction.dataset.inventoryChangeType;
    if (body.status || body.stock === 0 || body.supportsCash === false) {
      const confirmation = requestSensitiveReason("确认商品敏感变更", `商品 ${productAction.dataset.productAction} 将调整上下架、库存或现金购买能力。`, "后台商品运营调整");
      if (!confirmation.ok) return;
      body.reason = confirmation.reason;
    }
    api(`/api/admin/products/${productAction.dataset.productAction}`, { method: "PATCH", body: JSON.stringify(body) })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const reviewAction = event.target.closest("[data-task-review]");
  if (reviewAction) {
    api(`/api/admin/task-submissions/${reviewAction.dataset.taskReview}/${reviewAction.dataset.reviewAction}`, {
      method: "POST",
      body: JSON.stringify({ remarks: reviewAction.dataset.reviewAction === "approve" ? "后台审核通过" : "后台审核拒绝" })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const pointsAdjust = event.target.closest("[data-user-points-adjust]");
  if (pointsAdjust) {
    const rawDelta = window.prompt("请输入积分调整值，正数为补积分，负数为扣积分", "10");
    if (rawDelta === null) return;
    const pointsDelta = Math.trunc(Number(rawDelta));
    if (!Number.isFinite(pointsDelta) || pointsDelta === 0) {
      window.alert("积分调整值必须是非 0 数字");
      return;
    }
    const currentPoints = Number(pointsAdjust.dataset.userPoints || 0);
    if (currentPoints + pointsDelta < 0) {
      window.alert("积分调整后不能小于 0");
      return;
    }
    const confirmation = requestSensitiveReason("提交积分调整复核", `用户 ${pointsAdjust.dataset.userPointsAdjust} 将提交 ${pointsDelta > 0 ? "+" : ""}${pointsDelta} 积分调整申请，复核通过后才入账。`, "后台手工积分调整");
    if (!confirmation.ok) return;
    api("/api/admin/approval-requests", {
      method: "POST",
      body: JSON.stringify({
        action: "points.adjust",
        targetType: "user",
        targetId: pointsAdjust.dataset.userPointsAdjust,
        payload: { pointsDelta },
        reason: confirmation.reason
      })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const userAction = event.target.closest("[data-user-action]");
  if (userAction) {
    const body = { reason: "后台用户会员管理" };
    if (userAction.dataset.actionType === "extend") body.memberMonths = 1;
    if (userAction.dataset.actionType === "disable") body.status = "disabled";
    if (userAction.dataset.actionType === "enable") body.status = "active";
    if (userAction.dataset.actionType === "clearMember") body.clearMember = true;
    api(`/api/admin/users/${userAction.dataset.userAction}`, { method: "PATCH", body: JSON.stringify(body) })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const ticketAction = event.target.closest("[data-ticket-action]");
  if (ticketAction) {
    const status = ticketAction.dataset.actionType || "processing";
    const adminReply = status === "resolved" ? "已处理完成，如仍有问题请再次提交。" : "客服已受理，正在跟进。";
    api(`/api/admin/tickets/${ticketAction.dataset.ticketAction}`, {
      method: "PATCH",
      body: JSON.stringify({ status, adminReply, reason: "后台处理用户工单" })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const pickupAction = event.target.closest("[data-pickup-action]");
  if (pickupAction) {
    api(`/api/admin/pickup-sites/${pickupAction.dataset.pickupAction}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: pickupAction.dataset.enabled === "true", reason: "后台调整自提点状态" })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const deliveryTeamAction = event.target.closest("[data-delivery-team-action]");
  if (deliveryTeamAction) {
    api(`/api/admin/delivery-teams/${deliveryTeamAction.dataset.deliveryTeamAction}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: deliveryTeamAction.dataset.enabled === "true", reason: "后台调整配送团队状态" })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const paymentFilter = event.target.closest("[data-payment-filter]");
  if (paymentFilter) {
    setPaymentFilter(paymentFilter.dataset.filterKey, paymentFilter.dataset.filterValue);
    return;
  }

  const cancelTimeouts = event.target.closest("[data-cancel-payment-timeouts]");
  if (cancelTimeouts) {
    const confirmation = requestSensitiveReason("确认取消超时支付单", "系统会批量取消超过阈值仍未回调的待支付单，并写入异常补偿队列。", "批量取消超时未回调支付单");
    if (!confirmation.ok) return;
    api("/api/admin/payments/cancel-timeouts", {
      method: "POST",
      body: JSON.stringify({ timeoutMinutes: Number(cancelTimeouts.dataset.timeoutMinutes || 30), reason: confirmation.reason })
    })
      .then((result) => {
        state.paymentActionMessage = `已取消 ${result.cancelled?.length || 0} 笔超时支付单`;
        return loadDashboard();
      })
      .catch(() => renderAdminPage(state));
    return;
  }

  const scanDeliveryExceptions = event.target.closest("[data-scan-delivery-exceptions]");
  if (scanDeliveryExceptions) {
    const confirmation = requestSensitiveReason("扫描配送异常", "将扫描配送中超时未送达的自建配送订单，并进入异常补偿队列。", "配送超时巡检");
    if (!confirmation.ok) return;
    api("/api/admin/delivery/scan-exceptions", {
      method: "POST",
      body: JSON.stringify({ timeoutMinutes: Number(scanDeliveryExceptions.dataset.timeoutMinutes || 180), reason: confirmation.reason })
    }).then(() => loadDashboard()).catch((error) => toast(error.message));
    return;
  }

  const withdrawAction = event.target.closest("[data-withdraw-action]");
  if (withdrawAction) {
    const actionText = withdrawAction.dataset.actionType === "reject" ? "驳回提现" : "通过提现";
    const confirmation = requestSensitiveReason(`提交${actionText}复核`, `提现单 ${withdrawAction.dataset.withdrawAction} 将进入二级审批队列，复核通过后才执行${actionText}。`, `提交提现${actionText}复核`);
    if (!confirmation.ok) return;
    api("/api/admin/approval-requests", {
      method: "POST",
      body: JSON.stringify({
        action: `withdrawal.${withdrawAction.dataset.actionType}`,
        targetType: "withdrawal",
        targetId: withdrawAction.dataset.withdrawAction,
        reason: confirmation.reason
      })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const approvalAction = event.target.closest("[data-approval-action]");
  if (approvalAction) {
    const actionText = approvalAction.dataset.approvalAction === "reject" ? "驳回复核" : "复核通过并执行";
    const confirmation = requestSensitiveReason(`确认${actionText}`, `审批单 ${approvalAction.dataset.approvalId} 将被${actionText}。`, actionText);
    if (!confirmation.ok) return;
    api(`/api/admin/approval-requests/${approvalAction.dataset.approvalId}/${approvalAction.dataset.approvalAction}`, {
      method: "POST",
      body: JSON.stringify({ reason: confirmation.reason })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
  }
});

document.body.addEventListener("change", (event) => {
  const monthlyRewardMonth = event.target.closest("[data-monthly-reward-filter][data-filter-key=\"monthKey\"]");
  if (monthlyRewardMonth) {
    setMonthlyRewardFilter("monthKey", monthlyRewardMonth.value);
  }
});

document.body.addEventListener("submit", (event) => {
  const dashboardRangeForm = event.target.closest("[data-dashboard-range-form]");
  if (dashboardRangeForm) {
    event.preventDefault();
    const formData = new FormData(dashboardRangeForm);
    const startDate = String(formData.get("startDate") || "").trim();
    const endDate = String(formData.get("endDate") || "").trim();
    if (!startDate || !endDate) {
      window.alert("请选择完整的开始日期和结束日期");
      return;
    }
    if (new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)) {
      window.alert("结束日期不能早于开始日期");
      return;
    }
    state.dashboardFilters.range = "custom";
    state.dashboardFilters.startDate = startDate;
    state.dashboardFilters.endDate = endDate;
    loadDashboard().catch(() => renderAdminPage(state));
    return;
  }

  const productForm = event.target.closest("[data-product-create-form]");
  if (productForm) {
    event.preventDefault();
    const formData = new FormData(productForm);
    const purePointsOnly = formData.get("purePointsOnly") === "on";
    const payload = {
      name: String(formData.get("name") || ""),
      category: String(formData.get("category") || ""),
      cashPrice: purePointsOnly ? null : Number(formData.get("cashPrice")),
      pointsPrice: Number(formData.get("pointsPrice")),
      stock: Number(formData.get("stock")),
      tag: String(formData.get("tag") || ""),
      image: String(formData.get("image") || ""),
      status: String(formData.get("status") || "on"),
      supportsCash: !purePointsOnly && formData.get("supportsCash") === "on",
      purePointsOnly
    };
    api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const pickupForm = event.target.closest("[data-pickup-create-form]");
  if (pickupForm) {
    event.preventDefault();
    const formData = new FormData(pickupForm);
    api("/api/admin/pickup-sites", {
      method: "POST",
      body: JSON.stringify({
        name: String(formData.get("name") || ""),
        address: String(formData.get("address") || ""),
        contactName: String(formData.get("contactName") || ""),
        contactPhone: String(formData.get("contactPhone") || ""),
        enabled: formData.get("enabled") === "on",
        reason: "后台新增自提点"
      })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const deliveryTeamForm = event.target.closest("[data-delivery-team-create-form]");
  if (deliveryTeamForm) {
    event.preventDefault();
    const formData = new FormData(deliveryTeamForm);
    api("/api/admin/delivery-teams", {
      method: "POST",
      body: JSON.stringify({
        name: String(formData.get("name") || ""),
        serviceArea: String(formData.get("serviceArea") || ""),
        enabled: formData.get("enabled") === "on",
        reason: "后台新增配送团队"
      })
    })
      .then(loadDashboard)
      .catch(() => renderAdminPage(state));
    return;
  }

  const form = event.target.closest("[data-config-form]");
  if (!form) return;
  event.preventDefault();
  const formData = new FormData(form);
  const group = form.dataset.configForm || "settings";
  const payload = buildConfigPayload(group, formData);
  const titles = {
    member: ["确认保存会员支付", "月会员价格和支付超时将立即影响用户下单。"],
    delivery: ["确认保存履约配送", "自提、送货上门、配送费和配送时段将立即影响用户下单。"],
    points: ["确认保存积分任务", "邀请、签到、抽奖和排行榜配置将立即影响用户增长玩法。"],
    finance: ["确认保存财务展示", "提现金额、手续费和展示广告配置将立即生效。"],
    dashboard: ["确认保存仪表盘阈值", "预警阈值会立即影响大屏提示。"],
    home: ["确认保存首页运营", "首页 Banner、服务承诺和活动入口将立即展示给用户。"],
    ads: ["确认保存广告素材", "签到广告素材启停和位置将同步到签到广告配置。"]
  };
  const [title, message] = titles[group] || ["确认保存系统设置", "系统配置将立即生效。"];
  const confirmation = requestSensitiveReason(title, message, `后台保存${title.replace("确认保存", "")}`);
  if (!confirmation.ok) return;
  payload.reason = confirmation.reason;
  api("/api/admin/config", { method: "PATCH", body: JSON.stringify(payload) })
    .then(loadDashboard)
    .catch(() => renderAdminPage(state));
});

function buildConfigPayload(group, formData) {
  const payloads = {
    member: () => ({
      membershipMonthlyPrice: Number(formData.get("membershipMonthlyPrice")),
      paymentTimeoutMinutes: Number(formData.get("paymentTimeoutMinutes")),
      purePointsNoCashTopup: true
    }),
    delivery: () => ({
      pickupEnabled: formData.get("pickupEnabled") === "on",
      deliveryEnabled: formData.get("deliveryEnabled") === "on",
      deliveryFeeEnabled: formData.get("deliveryFeeEnabled") === "on",
      deliveryFee: Number(formData.get("deliveryFee")),
      deliveryCutoffHour: Number(formData.get("deliveryCutoffHour")),
      deliveryTimeSlots: parseListField(formData.get("deliveryTimeSlots")),
      purePointsNoCashTopup: true
    }),
    points: () => ({
      inviteRewardPoints: Number(formData.get("inviteRewardPoints")),
      inviteCommissionRate: Number(formData.get("inviteCommissionRatePercent")) / 100,
      monthlyPointRewardEnabled: formData.get("monthlyPointRewardEnabled") === "on",
      monthlyPointRewardSettlementHour: Number(formData.get("monthlyPointRewardSettlementHour")),
      monthlyPointRewardSettlementMinute: Number(formData.get("monthlyPointRewardSettlementMinute")),
      monthlyPointRewardRulesJson: String(formData.get("monthlyPointRewardRulesJson") || ""),
      signinAdGroupMin: Number(formData.get("signinAdGroupMin")),
      signinAdGroupMax: Number(formData.get("signinAdGroupMax")),
      signinStreakDays: Number(formData.get("signinStreakDays")),
      lotteryDailyLimit: Number(formData.get("lotteryDailyLimit")),
      rankingRefreshMinutes: Number(formData.get("rankingRefreshMinutes")),
      signinStreakRewardText: String(formData.get("signinStreakRewardText") || ""),
      purePointsNoCashTopup: true
    }),
    finance: () => ({
      withdrawMinAmount: Number(formData.get("withdrawMinAmount")),
      withdrawFeeRate: Number(formData.get("withdrawFeeRatePercent")) / 100,
      splashAdEnabled: formData.get("splashAdEnabled") === "on",
      purePointsNoCashTopup: true
    }),
    dashboard: () => ({
      dashboardAlertThresholds: {
        refundRate: Number(formData.get("refundRateThresholdPercent")) / 100,
        exceptionRate: Number(formData.get("exceptionRateThresholdPercent")) / 100,
        pendingShipCount: Number(formData.get("pendingShipThreshold")),
        pendingPickupCount: Number(formData.get("pendingPickupThreshold"))
      },
      purePointsNoCashTopup: true
    }),
    home: () => ({
      homeBannerTitle: String(formData.get("homeBannerTitle") || ""),
      homeBannerSubtitle: String(formData.get("homeBannerSubtitle") || ""),
      homeBannerProductId: String(formData.get("homeBannerProductId") || ""),
      homeServiceBadges: parseListField(formData.get("homeServiceBadges")),
      homeDeliveryPromise: {
        title: String(formData.get("homePromiseTitle") || ""),
        subtitle: String(formData.get("homePromiseSubtitle") || ""),
        cutoffText: String(formData.get("homePromiseCutoffText") || ""),
        deliveryFeeText: String(formData.get("homePromiseDeliveryFeeText") || ""),
        serviceAreaText: String(formData.get("homePromiseServiceAreaText") || "")
      },
      homePromotionEntries: parsePromotions(formData),
      purePointsNoCashTopup: true
    }),
    ads: () => ({
      signinAdMaterials: parseSigninAds(formData),
      purePointsNoCashTopup: true
    })
  };
  return (payloads[group] || (() => ({ purePointsNoCashTopup: true })))();
}

function parseListField(value) {
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePromotions(formData) {
  const titles = formData.getAll("promotionTitle");
  const texts = formData.getAll("promotionText");
  const pages = formData.getAll("promotionPage");
  const tones = formData.getAll("promotionTone");
  return titles
    .map((title, index) => ({
      title: String(title || "").trim(),
      text: String(texts[index] || "").trim(),
      page: String(pages[index] || "category").trim(),
      tone: String(tones[index] || "green").trim()
    }))
    .filter((item) => item.title);
}

function parseSigninAds(formData) {
  const names = formData.getAll("adName");
  const types = formData.getAll("adType");
  const positions = formData.getAll("adPosition");
  return names
    .map((name, index) => ({
      id: `ad_${index + 1}`,
      name: String(name || "").trim(),
      type: String(types[index] || "reward_video").trim(),
      enabled: formData.get(`adEnabled${index}`) === "on",
      position: String(positions[index] || "").trim()
    }))
    .filter((item) => item.name);
}

function exportDashboardSnapshot() {
  const payload = {
    generatedAt: new Date().toISOString(),
    view: state.view,
    filters: state.dashboardFilters,
    summary: state.summary,
    analytics: state.summary?.analytics || null,
    recentOrders: (state.orders || []).slice(0, 10)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  link.href = url;
  link.download = `tgg-dashboard-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDashboardCsv() {
  const summary = state.summary?.analytics?.dashboard?.selected || {};
  const rows = [
    ["metric", "value"],
    ["range", summary.rangeLabel || state.dashboardFilters.range || "month"],
    ["orderCount", summary.orderCount ?? 0],
    ["gmv", summary.gmv ?? 0],
    ["memberOpenCount", summary.memberOpenCount ?? 0],
    ["taskCount", summary.taskCount ?? 0],
    ["refundCount", summary.refundCount ?? 0],
    ["exceptionCount", summary.exceptionCount ?? 0],
    ["pointNet", summary.pointNet ?? 0],
    ["pendingPickup", summary.pendingPickup ?? 0],
    ["pendingShip", summary.pendingShip ?? 0]
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  link.href = url;
  link.download = `tgg-dashboard-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

renderAdminPage(state);
loadDashboard().catch(() => renderAdminPage(state));
window.setInterval(() => {
  if (document.visibilityState === "visible") {
    loadDashboard().catch(() => renderAdminPage(state));
  }
}, 60000);
