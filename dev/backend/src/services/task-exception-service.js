const tickets = require("../repositories/ticket-repository");

// Call only after trusted association and successful processing of its review result.
// This closes registration/mapping uncertainty, not unrelated reward or account issues.
function resolveTaskAssociationExceptions(state, submission, reason, roleId = "system") {
  if (submission.platform !== "bounty_platform" || !submission.externalOrderId) return;
  for (const exception of state.exceptions || []) {
    const linked = exception.type === "task_submit_uncertain" && exception.bizNo === submission.id ||
      exception.type === "task_callback_mapping_ambiguous" && String(exception.bizNo) === String(submission.externalOrderId);
    if (!linked || exception.payload?.userId != null && String(exception.payload.userId) !== String(submission.userId)) continue;
    if (exception.status !== "resolved") {
      exception.status = "resolved";
      exception.action = reason;
      exception.updatedAt = new Date().toISOString();
    }
    const ticket = tickets.findLinked(state, "exception", exception.id);
    if (ticket && ticket.status !== "resolved") tickets.resolveLinked(state, "exception", exception.id, exception.action || reason, roleId);
  }
}

module.exports = { resolveTaskAssociationExceptions };
