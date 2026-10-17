const { nextId, saveState } = require("../data/store");
const ledgerRepository = require("../repositories/ledger-repository");
const ticketRepository = require("../repositories/ticket-repository");
const { getMonthRange, toMonthKey } = require("../time-zone");
const { productionLike } = require("../config/runtime-safety");
const huifu = require("./withdrawal-provider/huifu-bafang");

function listPickupSites(state) {
  return state.pickupSites.filter((site) => site.enabled);
}

function listDeliveryTeams(state) {
  return state.deliveryTeams
    .filter((team) => team.enabled)
    .map((team) => ({
      ...team,
      staff: state.deliveryStaff.filter((staff) => staff.teamId === team.id && staff.enabled)
    }));
}

function listAddresses(state, userId) {
  return state.addresses.filter((address) => address.userId === userId);
}

function addressInServiceRange(state, input, fallback = true) {
  const text = [input.province, input.city, input.district, input.detail || input.address].filter(Boolean).join(" ");
  const keywords = Array.isArray(state.config?.deliveryServiceAreaKeywords)
    ? state.config.deliveryServiceAreaKeywords.map(value => String(value).trim()).filter(Boolean)
    : [];
  if (keywords.length) return keywords.some(keyword => text.includes(keyword));
  return input.inServiceRange === false ? false : fallback;
}

function createAddress(state, userId, input) {
  const now = new Date().toISOString();
  const userAddresses = state.addresses.filter((candidate) => candidate.userId === userId);
  const address = {
    id: nextId("addr"),
    userId,
    receiverName: input.receiverName || input.name || "收货人",
    mobile: input.mobile || input.phone || "",
    province: input.province || "",
    city: input.city || "",
    district: input.district || "",
    detail: input.detail || input.address || "",
    inServiceRange: addressInServiceRange(state, input),
    isDefault: Boolean(input.isDefault) || userAddresses.length === 0,
    createdAt: now,
    updatedAt: now
  };

  if (address.isDefault) {
    for (const item of userAddresses) item.isDefault = false;
  }
  state.addresses.unshift(address);
  saveState();
  return address;
}

function updateAddress(state, userId, addressId, input) {
  const address = state.addresses.find((item) => item.id === addressId && item.userId === userId);
  if (!address) return { ok: false, status: 404, error: "地址不存在" };

  const allowed = ["receiverName", "mobile", "province", "city", "district", "detail", "inServiceRange"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) address[key] = input[key];
  }
  if (Object.prototype.hasOwnProperty.call(input, "name")) address.receiverName = input.name;
  if (Object.prototype.hasOwnProperty.call(input, "phone")) address.mobile = input.phone;
  if (Object.prototype.hasOwnProperty.call(input, "address")) address.detail = input.address;
  if (input.isDefault === true) {
    for (const item of state.addresses.filter((candidate) => candidate.userId === userId)) item.isDefault = false;
    address.isDefault = true;
  }
  address.inServiceRange = addressInServiceRange(state, { ...address, ...input }, address.inServiceRange !== false);
  address.updatedAt = new Date().toISOString();
  saveState();
  return { ok: true, address };
}

function deleteAddress(state, userId, addressId) {
  const index = state.addresses.findIndex((item) => item.id === addressId && item.userId === userId);
  if (index < 0) return { ok: false, status: 404, error: "地址不存在" };

  const [removed] = state.addresses.splice(index, 1);
  if (removed.isDefault) {
    const nextDefault = state.addresses.find((item) => item.userId === userId);
    if (nextDefault) {
      nextDefault.isDefault = true;
      nextDefault.updatedAt = new Date().toISOString();
    }
  }
  saveState();
  return { ok: true, address: removed };
}

function listWithdrawals(state, userId) {
  return state.withdrawRequests.filter((item) => item.userId === userId).map(publicWithdrawal);
}
function getWithdrawal(state, userId, withdrawalId) {
  const withdrawal = state.withdrawRequests.find((item) => item.userId === userId && item.id === withdrawalId);
  return withdrawal ? publicWithdrawal(withdrawal) : null;
}
function publicWithdrawal(withdrawal = {}) {
  const fields = [
    "id", "amount", "fee", "arrivalAmount", "channel", "status", "recipientName",
    "transferState", "createdAt", "updatedAt", "submittedAt", "callbackAt", "lastQueryAt"
  ];
  return Object.fromEntries(fields
    .filter(key => Object.prototype.hasOwnProperty.call(withdrawal, key))
    .map(key => [key, withdrawal[key]]));
}

function requestWithdrawal(state, user, input) {
  const requestedKey = String(input.idempotencyKey || "").trim();
  const requestedAmount = roundMoney(input.amount);
  const requestedChannel = String(input.channel || "wechat").trim() || "wechat";
  const suppliedOpenid = String(input.openid || "").trim();
  const boundOpenid = String(user.wechatOpenid || user.openid || "").trim();
  if (productionLike() && suppliedOpenid && boundOpenid && suppliedOpenid !== boundOpenid) {
    return { ok: false, status: 400, error: "收款微信必须使用当前账号已绑定的微信" };
  }
  // In a live environment the recipient is always server-bound. The input
  // fallback exists only for isolated tests that use synthetic users.
  const requestedOpenid = productionLike() ? boundOpenid : (suppliedOpenid || boundOpenid);
  const requestedRecipientName = String(input.recipientName || "").trim();
  if (requestedKey) {
    const existing = state.withdrawRequests.find((item) => item.userId === user.id && item.idempotencyKey === requestedKey);
    if (existing) {
      const sameIntent = existing.amount === requestedAmount
        && existing.channel === requestedChannel
        && existing.openid === requestedOpenid
        && existing.recipientName === requestedRecipientName;
      return sameIntent
        ? { ok: true, withdrawal: existing, idempotent: true }
        : { ok: false, status: 409, error: "提现请求标识已用于其他提现意图" };
    }
  }
  const amount = requestedAmount;
  const minAmount = Number(state.config.withdrawMinAmount || 1);
  const feeRate = Number(state.config.withdrawFeeRate ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, status: 400, error: "提现金额必须是正数" };
  if (!Number.isFinite(minAmount) || minAmount <= 0) return { ok: false, status: 500, error: "提现配置无效，请联系管理员" };
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) return { ok: false, status: 500, error: "提现手续费配置无效，请联系管理员" };
  if (productionLike() && !requestedOpenid) return { ok: false, status: 400, error: "请先使用已绑定微信登录后再申请提现" };
  if (amount < minAmount) return { ok: false, status: 400, error: `最低提现金额为 ${minAmount} 元` };
  if (amount > user.withdrawableBalance) return { ok: false, status: 400, error: "可提现余额不足" };

  const timeZone = state.config.deliveryTimeZone || "Asia/Shanghai";
  const dateKey = value => new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(value));
  const today = dateKey(Date.now());
  const counted = (state.withdrawRequests || []).filter(item => item.userId === user.id
    && dateKey(item.createdAt || item.updatedAt || 0) === today
    && !["failed", "rejected", "cancelled"].includes(item.status));
  const countLimit = Number(state.config.withdrawDailyCountLimit || 0);
  const amountLimit = Number(state.config.withdrawDailyAmountLimit || 0);
  if (countLimit > 0 && counted.length >= countLimit) {
    return { ok: false, status: 400, error: `每日最多提现 ${countLimit} 次` };
  }
  const usedAmount = counted.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (amountLimit > 0 && usedAmount + amount > amountLimit + 0.005) {
    return { ok: false, status: 400, error: `每日提现金额不能超过 ${amountLimit} 元` };
  }

  // A live PostgreSQL deployment must never freeze funds until its payout rail is configured.
  if (String(process.env.TGG_STORE_DRIVER || "json") === "pg"
    && process.env.TGG_TEST_BYPASS_ENABLED !== "1"
    && !huifu.isConfigured()) {
    return { ok: false, status: 503, error: "汇服八方提现通道未配置，请联系管理员" };
  }

  const fee = roundMoney(amount * feeRate);
  const arrivalAmount = roundMoney(amount - fee);
  if (arrivalAmount <= 0) return { ok: false, status: 400, error: "扣除手续费后到账金额必须大于 0 元" };
  const now = new Date().toISOString();
  const withdrawal = {
    id: nextId("wd"),
    userId: user.id,
    amount,
    fee,
    arrivalAmount,
    channel: requestedChannel,
    status: "pending_review",
    idempotencyKey: requestedKey || `withdraw:${user.id}:${Date.now()}`,
    openid: requestedOpenid,
    recipientName: requestedRecipientName,
    provider: "huifu_bafang",
    providerStatus: "pending",
    createdAt: now,
    updatedAt: now
  };

  user.withdrawableBalance = roundMoney(user.withdrawableBalance - amount);
  ledgerRepository.addWithdrawableEntry(state, {
    id: nextId("wlg"),
    userId: user.id,
    changeType: "withdraw_freeze",
    direction: "freeze",
    amount,
    balanceAfter: user.withdrawableBalance,
    bizNo: withdrawal.id,
    idempotencyKey: `${withdrawal.id}:freeze`,
    createdAt: now
  });
  state.withdrawRequests.unshift(withdrawal);
  saveState();
  return { ok: true, withdrawal, idempotent: false };
}

function getPointLedger(state, userId, filters = {}) {
  const type = String(filters.type || "").trim();
  const direction = String(filters.direction || "").trim();
  const rows = state.pointLedger.filter((item) => item.userId === userId && (!type || item.changeType === type) && (!direction || item.direction === direction));
  // Preserve the existing array contract for the web client.
  if (!filters.page && !filters.count) return rows;
  const integer = (value, fallback, max) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;
  const page = integer(filters.page, 1, 1000000);
  const count = integer(filters.count, 20, 100);
  const selected = rows.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
  return { rows: selected.slice((page - 1) * count, page * count).map(item => {
    let source = null;
    const order = state.orders.find(row => row.id === item.bizNo && row.userId === userId);
    const refund = state.refundOrders.find(row => row.id === item.bizNo && row.userId === userId);
    const submission = state.submissions.find(row => row.id === item.bizNo && row.userId === userId);
    if (order) source = { type: "order", id: order.id };
    else if (refund) source = { type: "order", id: refund.orderId };
    else if (submission) source = { type: "submission", id: submission.id };
    else if (["invite_reward", "invite_commission"].includes(item.changeType)) source = { type: "invite" };
    return { ...item, source };
  }), total: rows.length, page, count };
}

function getRanking(state, userId) {
  const scoreTypes = new Set(["signin", "lottery", "task_reward", "invite_reward", "invite_commission", "ranking_reward"]);
  const scores = new Map();
  for (const user of state.users) scores.set(user.id, { userId: user.id, nickname: user.nickname, score: 0 });
  const monthKey = toMonthKey(new Date(), "Asia/Shanghai");
  const monthRange = getMonthRange(monthKey, "Asia/Shanghai");
  for (const entry of state.pointLedger) {
    if (entry.direction === "in" && scoreTypes.has(entry.changeType)) {
      const createdAt = new Date(entry.createdAt || 0);
      if (Number.isNaN(createdAt.getTime()) || createdAt < monthRange.start || createdAt >= monthRange.end) continue;
      scores.get(entry.userId).score += entry.points;
    }
  }
  const rows = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return {
    period: monthKey,
    refreshMinutes: state.config.rankingRefreshMinutes,
    currentUser: rows.find((item) => item.userId === userId) || null,
    rows
  };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function listTickets(state, userId) {
  return ticketRepository.listByUser(state, userId);
}

function createTicket(state, user, input = {}) {
  const type = normalizeTicketType(input.type || input.ticketType || input.scene);
  const subject = String(input.subject || defaultTicketSubject(type)).trim();
  const content = String(input.content || input.message || "").trim();
  if (!content) return { ok: false, status: 400, error: "请填写问题描述" };

  const ticket = ticketRepository.add(state, {
    userId: user.id,
    type,
    subject,
    content,
    contactName: String(input.contactName || user.nickname || "").trim(),
    contactPhone: String(input.contactPhone || user.phone || "").trim(),
    status: "open",
    priority: "normal"
  });
  saveState();
  return { ok: true, ticket };
}

function normalizeTicketType(type) {
  return ["customer_service", "feedback", "business", "recruiting"].includes(type) ? type : "customer_service";
}

function defaultTicketSubject(type) {
  return ({ customer_service: "客服咨询", feedback: "用户反馈", business: "商务合作", recruiting: "招聘咨询" })[type] || "用户咨询";
}

module.exports = {
  listPickupSites,
  listDeliveryTeams,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  listWithdrawals,
  getWithdrawal,
  publicWithdrawal,
  requestWithdrawal,
  getPointLedger,
  getRanking,
  listTickets,
  createTicket
};
