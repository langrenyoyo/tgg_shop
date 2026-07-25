const { publicRole, requireAdminPermission, resolveAdmin } = require("../domain/auth");
const { createException, resolveException } = require("../domain/exception-rules");
const { verifyPickup, shipOrder, deliverOrder, createDeliveryException } = require("../domain/fulfillment-rules");
const { approveRefund } = require("../domain/refund-rules");
const { handleTaskCallback } = require("../domain/task-callback-rules");
const { nextId, saveState } = require("../data/store");
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

function getSummary(state) {
  return adminRepository.countSummary(state);
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
  state.config.purePointsNoCashTopup = true;

  logOperation(state, actor, "config.update", "config", "system", { before, after: state.config, reason: cleanReason(input.reason) });
  saveState();
  return state.config;
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
    const task = taskRepository.findById(state, submission.taskId);
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
    (action === "points.adjust" && targetType === "user")
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
  logPaymentTimeoutCancellation
};
