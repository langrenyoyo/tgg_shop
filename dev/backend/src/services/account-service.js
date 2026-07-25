const { nextId, saveState } = require("../data/store");
const ledgerRepository = require("../repositories/ledger-repository");
const ticketRepository = require("../repositories/ticket-repository");

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
    inServiceRange: input.inServiceRange !== false,
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
  return state.withdrawRequests.filter((item) => item.userId === userId);
}

function requestWithdrawal(state, user, input) {
  const amount = roundMoney(input.amount);
  const minAmount = Number(state.config.withdrawMinAmount || 1);
  if (!amount || amount < minAmount) return { ok: false, status: 400, error: `最低提现金额为 ${minAmount} 元` };
  if (amount > user.withdrawableBalance) return { ok: false, status: 400, error: "可提现余额不足" };

  const fee = roundMoney(amount * Number(state.config.withdrawFeeRate || 0));
  const arrivalAmount = roundMoney(amount - fee);
  const now = new Date().toISOString();
  const withdrawal = {
    id: nextId("wd"),
    userId: user.id,
    amount,
    fee,
    arrivalAmount,
    channel: input.channel || "wechat",
    status: "pending_review",
    idempotencyKey: input.idempotencyKey || `withdraw:${user.id}:${Date.now()}`,
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
  return { ok: true, withdrawal };
}

function getPointLedger(state, userId) {
  return state.pointLedger.filter((item) => item.userId === userId);
}

function getRanking(state, userId) {
  const scoreTypes = new Set(["signin", "lottery", "task_reward", "invite_reward", "invite_commission", "ranking_reward"]);
  const scores = new Map();
  for (const user of state.users) scores.set(user.id, { userId: user.id, nickname: user.nickname, score: 0 });
  for (const entry of state.pointLedger) {
    if (entry.direction === "in" && scoreTypes.has(entry.changeType)) {
      scores.get(entry.userId).score += entry.points;
    }
  }
  const rows = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return {
    period: new Date().toISOString().slice(0, 7),
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
  requestWithdrawal,
  getPointLedger,
  getRanking,
  listTickets,
  createTicket
};
