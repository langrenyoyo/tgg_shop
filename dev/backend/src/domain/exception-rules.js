const { nextId, saveState } = require("../data/store");
const adminRepository = require("../repositories/admin-repository");
const ticketRepository = require("../repositories/ticket-repository");

function createException(state, input) {
  const now = new Date().toISOString();
  const exception = {
    id: input.id || nextId("ex"),
    type: input.type || input.exceptionType,
    bizNo: input.bizNo,
    action: input.action,
    status: input.status || "pending",
    payload: input.payload || {},
    createdAt: now,
    updatedAt: now
  };
  state.exceptions.unshift(exception);
  ticketRepository.createLinked(state, {
    userId: input.payload?.userId || null,
    type: "customer_service",
    subject: `异常补偿跟进 ${exception.type}`,
    content: `${exception.action || "异常待处理"}，业务号：${exception.bizNo || "-"}`,
    linkedType: "exception",
    linkedId: exception.id,
    priority: "high"
  });
  saveState();
  return exception;
}

function resolveException(state, exceptionId, action = "人工确认完成") {
  const exception = adminRepository.listExceptions(state).find((item) => item.id === exceptionId);
  if (!exception) return { ok: false, status: 404, error: "异常记录不存在" };
  if (exception.status === "resolved") return { ok: false, status: 400, error: "异常已处理" };

  exception.status = "resolved";
  exception.action = action;
  exception.updatedAt = new Date().toISOString();
  ticketRepository.resolveLinked(state, "exception", exception.id, `异常补偿已处理：${action}`, "system");
  saveState();
  return { ok: true, exception };
}

module.exports = {
  createException,
  resolveException
};
