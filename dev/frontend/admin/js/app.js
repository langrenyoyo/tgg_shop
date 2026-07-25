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
  paymentFilters: {
    paymentStatus: "",
    payScene: "",
    channel: ""
  },
  paymentActionMessage: "",
  identity: null,
  role: getAdminRole()
};

async function loadDashboard() {
  const [identity, summary, orders, products, inventoryLedger, ledger, roles, refunds, exceptions, config, pickupSites, deliveryTeams, withdrawals, users, addresses, invites, tickets, ranking, approvalRequests, orderStatusLogs, operationLogs, taskSubmissions] = await Promise.all([
    safeApi("/api/admin/auth/me", null),
    safeApi("/api/admin/summary", {}),
    safeApi("/api/admin/orders", []),
    safeApi("/api/admin/products", []),
    safeApi("/api/admin/inventory-ledger", []),
    safeApi(paymentLedgerPath(), { pointLedger: [], paymentLedger: [] }),
    safeApi("/api/admin/permissions", []),
    safeApi("/api/admin/refunds", []),
    safeApi("/api/admin/exceptions", []),
    safeApi("/api/admin/config", {}),
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
    safeApi("/api/admin/task-submissions", [])
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

function setPaymentFilter(key, value) {
  state.paymentFilters[key] = state.paymentFilters[key] === value ? "" : value;
  loadDashboard().catch(() => renderAdminPage(state));
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

document.body.addEventListener("submit", (event) => {
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

renderAdminPage(state);
loadDashboard().catch(() => renderAdminPage(state));
