export const financeActions = {
  "refund.approve": "退款通过", "withdrawal.approve": "提现通过", "withdrawal.reject": "提现驳回",
  "points.adjust": "手工积分调整", "monthly_reward.reverse": "月度奖励追回"
};

export function filterFinance(state) {
  const filters = state.financeFilters || {};
  const refunds = state.refunds || [], withdrawals = state.withdrawals || [], approvals = state.approvalRequests || [];
  const contains = (values, query) => !String(query || "").trim() || values.some(value => value != null && String(value).toLocaleLowerCase().includes(String(query).trim().toLocaleLowerCase()));
  function matches(kind, row) {
    const related = kind === "approvals" ? [row] : approvals.filter(item => item.targetType === (kind === "refunds" ? "refund" : "withdrawal") && item.targetId === row.id);
    const refund = kind === "refunds" ? row : kind === "approvals" && row.targetType === "refund" ? refunds.find(item => item.id === row.targetId) : null;
    const withdrawal = kind === "withdrawals" ? row : kind === "approvals" && row.targetType === "withdrawal" ? withdrawals.find(item => item.id === row.targetId) : null;
    const settlement = kind === "approvals" && row.action === "monthly_reward.reverse" ? (state.monthlyPointRewardOverview?.settlements || []).find(item => item.id === row.targetId) : null;
    const snapshot = kind === "approvals" ? row.payload?.targetSnapshot : null;
    const userId = refund?.userId || withdrawal?.userId || (kind === "approvals" && row.targetType === "user" ? row.targetId : row.userId || settlement?.userId || snapshot?.userId);
    const user = (state.users || []).find(item => item.id === userId);
    const orderId = refund?.orderId || row.orderId || snapshot?.orderId;
    const order = (state.orders || []).find(item => item.id === orderId);
    const refundIds = [refund?.id, kind === "approvals" && row.targetType === "refund" ? row.targetId : null];
    const withdrawalIds = [withdrawal?.id, kind === "approvals" && row.targetType === "withdrawal" ? row.targetId : null];
    // An approval ID and action must match the same linked request.
    const approvalMatches = related.some(item => contains([item.id], filters.approvalId) && (!filters.action || item.action === filters.action));
    const intrinsicActions = kind === "refunds" ? ["refund.approve"] : kind === "withdrawals" ? ["withdrawal.approve", "withdrawal.reject"] : [];
    const actionMatches = filters.approvalId ? approvalMatches : !filters.action || related.some(item => item.action === filters.action) || intrinsicActions.includes(filters.action);
    return contains([orderId, order?.orderNo], filters.orderId)
      && contains([userId, user?.nickname, user?.phone], filters.user)
      && contains(refundIds, filters.refundId) && contains(withdrawalIds, filters.withdrawalId)
      && actionMatches && (!filters.status || row.status === filters.status);
  }
  return { ...state, refunds: refunds.filter(row => matches("refunds", row)), withdrawals: withdrawals.filter(row => matches("withdrawals", row)), approvalRequests: approvals.filter(row => matches("approvals", row)) };
}

export function financeToolbar(state, e, zh) {
  const filters = state.financeFilters || {};
  const fields = [["orderId", "订单号"], ["user", "用户"], ["refundId", "退款单"], ["withdrawalId", "提现单"], ["approvalId", "审批单"]];
  const actions = [...new Set([...Object.keys(financeActions), ...(state.approvalRequests || []).map(item => item.action)])].filter(Boolean);
  const statuses = [...new Set(["pending_review", "pending", "approved", "rejected", "executed", "refunded", "paid", "processing", "failed", ...[...(state.refunds || []), ...(state.withdrawals || []), ...(state.approvalRequests || [])].map(item => item.status)])].filter(Boolean);
  const select = (name, label, options, title) => `<label>${label}<select name="${name}"><option value="">全部</option>${options.map(value => `<option value="${e(value)}" ${filters[name] === value ? "selected" : ""}>${e(title(value))}</option>`).join("")}</select></label>`;
  return `<form class="admin-form finance-filter" data-finance-filter-form>${fields.map(([name, label]) => `<label>${label}<input name="${name}" value="${e(filters[name] || "")}" placeholder="${name === "user" ? "用户ID / 昵称 / 手机号" : label}" maxlength="120"></label>`).join("")}${select("action", "动作", actions, value => financeActions[value] || value)}${select("status", "状态", statuses, value => zh(value))}<div class="table-actions"><button class="action" type="submit">查询</button><button class="action muted-action" type="button" data-finance-reset>重置</button></div></form>`;
}
