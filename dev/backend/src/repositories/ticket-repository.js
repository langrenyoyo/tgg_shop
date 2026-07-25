const { nextId } = require("../data/store");

function listByUser(state, userId) {
  return (state.operationTickets || []).filter((ticket) => ticket.userId === userId);
}

function findLinked(state, linkedType, linkedId) {
  return (state.operationTickets || []).find((ticket) => ticket.linkedType === linkedType && ticket.linkedId === linkedId);
}

function add(state, input = {}) {
  state.operationTickets ||= [];
  const now = input.createdAt || new Date().toISOString();
  const ticket = {
    id: input.id || nextId("tic"),
    userId: input.userId || null,
    type: normalizeTicketType(input.type),
    subject: String(input.subject || "客服工单").trim(),
    content: String(input.content || "").trim(),
    contactName: String(input.contactName || "").trim(),
    contactPhone: String(input.contactPhone || "").trim(),
    status: input.status || "open",
    adminReply: input.adminReply || "",
    handledByRoleId: input.handledByRoleId || "",
    linkedType: input.linkedType || "",
    linkedId: input.linkedId || "",
    priority: normalizePriority(input.priority),
    createdAt: now,
    updatedAt: input.updatedAt || now
  };
  state.operationTickets.unshift(ticket);
  return ticket;
}

function createLinked(state, input = {}) {
  if (input.linkedType && input.linkedId) {
    const existing = findLinked(state, input.linkedType, input.linkedId);
    if (existing) return existing;
  }
  return add(state, input);
}

function resolveLinked(state, linkedType, linkedId, adminReply, handledByRoleId = "system") {
  const ticket = findLinked(state, linkedType, linkedId);
  if (!ticket) return null;
  ticket.status = "resolved";
  ticket.adminReply = adminReply || ticket.adminReply || "系统自动处理完成";
  ticket.handledByRoleId = handledByRoleId;
  ticket.updatedAt = new Date().toISOString();
  return ticket;
}

function normalizeTicketType(type) {
  return ["customer_service", "feedback", "business", "recruiting"].includes(type) ? type : "customer_service";
}

function normalizePriority(priority) {
  return ["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal";
}

module.exports = {
  listByUser,
  findLinked,
  add,
  createLinked,
  resolveLinked
};
