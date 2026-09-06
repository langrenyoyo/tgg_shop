const adminService = require("../services/admin-service");
const paymentService = require("../services/payment-service");

async function handleAdminRoutes(ctx) {
  const { req, url, state, send } = ctx;
  if (!url.pathname.startsWith("/api/admin/")) return false;

  if (req.method === "GET" && url.pathname === "/api/admin/auth/me") {
    const identity = adminService.getAdminIdentity(req, state);
    return identity ? send(ctx.res, 200, identity) : send(ctx.res, 401, { error: "请先登录后台" });
  }

  const permissionByPath = {
    "/api/admin/summary": "order:read",
    "/api/admin/dashboard-views": "order:read",
    "/api/admin/orders": "order:read",
    "/api/admin/products": "product:read",
    "/api/admin/inventory-ledger": "stock:write",
    "/api/admin/ledger": "ledger:read",
    "/api/admin/permissions": "role:read",
    "/api/admin/exceptions": "exception:read",
    "/api/admin/refunds": "refund:approve",
    "/api/admin/withdrawals": "withdraw:approve",
    "/api/admin/config": "config:read",
    "/api/admin/monthly-point-rewards": "config:read",
    "/api/admin/pickup-sites": "pickup_site:write",
    "/api/admin/delivery-teams": "delivery:dispatch",
    "/api/admin/order-status-logs": "order:read",
    "/api/admin/operation-logs": "role:read",
    "/api/admin/approval-requests": "approval:request",
    "/api/admin/task-submissions": "task:review",
    "/api/admin/users": "customer:read",
    "/api/admin/addresses": "customer:read",
    "/api/admin/invites": "customer:read",
    "/api/admin/tickets": "ticket:write"
  };

  const requiredPermission = permissionByPath[url.pathname];
  if (requiredPermission) {
    const check = adminService.requirePermission(req, state, requiredPermission);
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/summary") {
    return send(ctx.res, 200, adminService.getSummary(state, Object.fromEntries(url.searchParams.entries())));
  }

  if (req.method === "GET" && url.pathname === "/api/admin/dashboard-views") {
    const check = adminService.requirePermission(req, state, "order:read");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    return send(ctx.res, 200, adminService.listDashboardViews(state, check));
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/dashboard-views") {
    const check = adminService.requirePermission(req, state, "order:read");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.saveDashboardViews(state, await ctx.readBody(req), check);
    return send(ctx.res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/admin/orders") return send(ctx.res, 200, state.orders);

  const pickupVerifyMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/pickup-verify$/);
  if (req.method === "POST" && pickupVerifyMatch) {
    const check = adminService.requirePermission(req, state, "order:fulfillment");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.verifyPickupOrder(state, pickupVerifyMatch[1], body.pickupCode, check, body.reason);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.order : { error: result.error });
  }

  const shipMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/ship$/);
  if (req.method === "POST" && shipMatch) {
    const check = adminService.requirePermission(req, state, "order:fulfillment");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.shipDeliveryOrder(state, shipMatch[1], body.staffId, check, body.reason);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.order : { error: result.error });
  }

  const deliverMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/deliver$/);
  if (req.method === "POST" && deliverMatch) {
    const check = adminService.requirePermission(req, state, "order:fulfillment");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.completeDeliveryOrder(state, deliverMatch[1], check, body.reason);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.order : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/delivery/scan-exceptions") {
    const check = adminService.requirePermission(req, state, "delivery:dispatch");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.scanDeliveryExceptions(state, await ctx.readBody(req), check);
    return send(ctx.res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/admin/products") return send(ctx.res, 200, state.products);
  if (req.method === "GET" && url.pathname === "/api/admin/inventory-ledger") return send(ctx.res, 200, adminService.listInventoryLedger(state));
  if (req.method === "POST" && url.pathname === "/api/admin/products") {
    const check = adminService.requirePermission(req, state, "product:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.createProduct(state, await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.product : { error: result.error });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/config") return send(ctx.res, 200, state.config);
  if (req.method === "GET" && url.pathname === "/api/admin/monthly-point-rewards") {
    const check = adminService.requirePermission(req, state, "config:read");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    return send(ctx.res, 200, adminService.getMonthlyPointRewardOverview(state, Object.fromEntries(url.searchParams.entries())));
  }
  if (req.method === "PATCH" && url.pathname === "/api/admin/config") {
    const check = adminService.requirePermission(req, state, "config:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    return send(ctx.res, 200, adminService.updateConfig(state, await ctx.readBody(req), check));
  }
  if (req.method === "POST" && url.pathname === "/api/admin/monthly-point-rewards/settle") {
    const check = adminService.requirePermission(req, state, "config:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    return send(ctx.res, 200, adminService.settleMonthlyPointRewardBatch(state, body, check));
  }

  const monthlyRewardReverseMatch = url.pathname.match(/^\/api\/admin\/monthly-point-rewards\/([^/]+)\/reverse$/);
  if (req.method === "POST" && monthlyRewardReverseMatch) {
    const check = adminService.requirePermission(req, state, "config:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.reverseMonthlyPointRewardSettlement(state, monthlyRewardReverseMatch[1], body, check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (req.method === "PATCH" && productMatch) {
    const check = adminService.requirePermission(req, state, "product:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.updateProduct(state, productMatch[1], await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.product : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/task-submissions") return send(ctx.res, 200, adminService.listTaskSubmissions(state));

  if (req.method === "GET" && url.pathname === "/api/admin/users") return send(ctx.res, 200, adminService.listUsers(state));
  if (req.method === "GET" && url.pathname === "/api/admin/addresses") return send(ctx.res, 200, adminService.listAddresses(state));
  if (req.method === "GET" && url.pathname === "/api/admin/invites") return send(ctx.res, 200, adminService.listInviteAudits(state));

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (req.method === "PATCH" && userMatch) {
    const check = adminService.requirePermission(req, state, "customer:read");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.updateUser(state, userMatch[1], await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.user : { error: result.error });
  }

  const taskApproveMatch = url.pathname.match(/^\/api\/admin\/task-submissions\/([^/]+)\/approve$/);
  if (req.method === "POST" && taskApproveMatch) {
    const check = adminService.requirePermission(req, state, "task:review");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.reviewTaskSubmission(state, taskApproveMatch[1], "approved", body.remarks || "admin approved", check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.submission : { error: result.error });
  }

  const taskRejectMatch = url.pathname.match(/^\/api\/admin\/task-submissions\/([^/]+)\/reject$/);
  if (req.method === "POST" && taskRejectMatch) {
    const check = adminService.requirePermission(req, state, "task:review");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.reviewTaskSubmission(state, taskRejectMatch[1], "rejected", body.remarks || "admin rejected", check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.submission : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/pickup-sites") return send(ctx.res, 200, adminService.listPickupSites(state));
  if (req.method === "POST" && url.pathname === "/api/admin/pickup-sites") {
    const check = adminService.requirePermission(req, state, "pickup_site:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.createPickupSite(state, await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.site : { error: result.error });
  }
  const pickupSiteMatch = url.pathname.match(/^\/api\/admin\/pickup-sites\/([^/]+)$/);
  if (req.method === "PATCH" && pickupSiteMatch) {
    const check = adminService.requirePermission(req, state, "pickup_site:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.updatePickupSite(state, pickupSiteMatch[1], await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.site : { error: result.error });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/delivery-teams") return send(ctx.res, 200, adminService.listDeliveryTeams(state));
  if (req.method === "POST" && url.pathname === "/api/admin/delivery-teams") {
    const check = adminService.requirePermission(req, state, "delivery:dispatch");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.createDeliveryTeam(state, await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.team : { error: result.error });
  }
  const deliveryTeamMatch = url.pathname.match(/^\/api\/admin\/delivery-teams\/([^/]+)$/);
  if (req.method === "PATCH" && deliveryTeamMatch) {
    const check = adminService.requirePermission(req, state, "delivery:dispatch");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.updateDeliveryTeam(state, deliveryTeamMatch[1], await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.team : { error: result.error });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/tickets") return send(ctx.res, 200, adminService.listTickets(state));
  const ticketMatch = url.pathname.match(/^\/api\/admin\/tickets\/([^/]+)$/);
  if (req.method === "PATCH" && ticketMatch) {
    const check = adminService.requirePermission(req, state, "ticket:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.updateTicket(state, ticketMatch[1], await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.ticket : { error: result.error });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/order-status-logs") return send(ctx.res, 200, adminService.listOrderStatusLogs(state));
  if (req.method === "GET" && url.pathname === "/api/admin/operation-logs") return send(ctx.res, 200, adminService.listOperationLogs(state));
  if (req.method === "GET" && url.pathname === "/api/admin/approval-requests") return send(ctx.res, 200, adminService.listApprovalRequests(state));
  if (req.method === "POST" && url.pathname === "/api/admin/approval-requests") {
    const check = adminService.requirePermission(req, state, "approval:request");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = adminService.requestApproval(state, await ctx.readBody(req), check);
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.approvalRequest : { error: result.error });
  }

  const approveApprovalMatch = url.pathname.match(/^\/api\/admin\/approval-requests\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveApprovalMatch) {
    const check = adminService.requirePermission(req, state, "approval:review");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.approveApprovalRequest(state, approveApprovalMatch[1], check, body.reason);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.approvalRequest : { error: result.error, approvalRequest: result.approvalRequest });
  }

  const rejectApprovalMatch = url.pathname.match(/^\/api\/admin\/approval-requests\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectApprovalMatch) {
    const check = adminService.requirePermission(req, state, "approval:review");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.rejectApprovalRequest(state, rejectApprovalMatch[1], check, body.reason);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.approvalRequest : { error: result.error });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/ledger") {
    return send(ctx.res, 200, adminService.getLedger(state, Object.fromEntries(url.searchParams.entries())));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/payments/cancel-timeouts") {
    const check = adminService.requirePermission(req, state, "exception:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = paymentService.cancelTimedOutPayments(state, body);
    adminService.logPaymentTimeoutCancellation(state, check, result, body.reason);
    return send(ctx.res, 200, result);
  }
  if (req.method === "GET" && url.pathname === "/api/admin/permissions") return send(ctx.res, 200, adminService.listRoles(state));
  if (req.method === "GET" && url.pathname === "/api/admin/exceptions") return send(ctx.res, 200, adminService.listExceptions(state));
  if (req.method === "POST" && url.pathname === "/api/admin/exceptions") {
    const check = adminService.requirePermission(req, state, "exception:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    return send(ctx.res, 201, adminService.createExceptionRecord(state, body));
  }

  const resolveExceptionMatch = url.pathname.match(/^\/api\/admin\/exceptions\/([^/]+)\/resolve$/);
  if (req.method === "POST" && resolveExceptionMatch) {
    const check = adminService.requirePermission(req, state, "exception:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await ctx.readBody(req);
    const result = adminService.resolveExceptionRecord(state, resolveExceptionMatch[1], body.action, check, body.reason);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.exception : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/refunds") return send(ctx.res, 200, adminService.listRefunds(state));
  if (req.method === "GET" && url.pathname === "/api/admin/withdrawals") return send(ctx.res, 200, adminService.listWithdrawals(state));

  const approveWithdrawalMatch = url.pathname.match(/^\/api\/admin\/withdrawals\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveWithdrawalMatch) {
    const check = adminService.requirePermission(req, state, "withdraw:approve");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    return send(ctx.res, 409, { error: "提现通过属于敏感财务操作，请先提交二级审批", action: "withdrawal.approve", targetId: approveWithdrawalMatch[1] });
  }

  const rejectWithdrawalMatch = url.pathname.match(/^\/api\/admin\/withdrawals\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectWithdrawalMatch) {
    const check = adminService.requirePermission(req, state, "withdraw:approve");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    return send(ctx.res, 409, { error: "提现驳回属于敏感财务操作，请先提交二级审批", action: "withdrawal.reject", targetId: rejectWithdrawalMatch[1] });
  }

  const approveRefundMatch = url.pathname.match(/^\/api\/admin\/refunds\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveRefundMatch) {
    const check = adminService.requirePermission(req, state, "refund:approve");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    return send(ctx.res, 409, { error: "退款通过属于敏感财务操作，请先提交二级审批", action: "refund.approve", targetId: approveRefundMatch[1] });
  }

  return false;
}

module.exports = {
  handleAdminRoutes
};
