process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const { createRefundRequest } = require("../../src/domain/refund-rules");
const adminService = require("../../src/services/admin-service");

function actor(state, roleId) {
  return { role: state.roles.find((role) => role.id === roleId) };
}

test("refund approval requires secondary review before execution", () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  const beforePoints = user.points;
  const orderResult = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "pickup",
    items: [{ productId: "p_banana", quantity: 1 }]
  });
  const refundResult = createRefundRequest(state, "u_1002", orderResult.order.id, "测试退款");

  const request = adminService.requestApproval(
    state,
    {
      action: "refund.approve",
      targetType: "refund",
      targetId: refundResult.refundOrder.id,
      reason: "财务提交退款复核"
    },
    actor(state, "finance_admin")
  );

  assert.equal(request.ok, true);
  assert.equal(request.approvalRequest.status, "pending");
  assert.equal(refundResult.refundOrder.status, "pending_review");
  assert.equal(orderResult.order.status, "refunding");

  const sameRoleReview = adminService.approveApprovalRequest(state, request.approvalRequest.id, actor(state, "finance_admin"), "自己复核");
  assert.equal(sameRoleReview.ok, false);
  assert.equal(sameRoleReview.status, 400);
  assert.equal(refundResult.refundOrder.status, "pending_review");

  const reviewed = adminService.approveApprovalRequest(state, request.approvalRequest.id, actor(state, "audit_ops"), "复核通过");
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.approvalRequest.status, "executed");
  assert.equal(refundResult.refundOrder.status, "refunded");
  assert.equal(orderResult.order.status, "refunded");
  assert.equal(user.points, beforePoints);
  assert.equal(state.adminOperationLogs.some((item) => item.action === "approval.execute"), true);
});

test("manual points adjustment requires secondary review and writes ledger", () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  const beforePoints = user.points;

  const request = adminService.requestApproval(
    state,
    {
      action: "points.adjust",
      targetType: "user",
      targetId: user.id,
      payload: { pointsDelta: 25 },
      reason: "manual points compensation"
    },
    actor(state, "finance_admin")
  );

  assert.equal(request.ok, true);
  assert.equal(request.approvalRequest.status, "pending");
  assert.equal(user.points, beforePoints);

  const sameRoleReview = adminService.approveApprovalRequest(state, request.approvalRequest.id, actor(state, "finance_admin"), "same role review");
  assert.equal(sameRoleReview.ok, false);
  assert.equal(user.points, beforePoints);

  const reviewed = adminService.approveApprovalRequest(state, request.approvalRequest.id, actor(state, "audit_ops"), "points review passed");
  assert.equal(reviewed.ok, true);
  assert.equal(user.points, beforePoints + 25);
  assert.equal(state.pointLedger[0].changeType, "manual_adjust");
  assert.equal(state.pointLedger[0].bizNo, request.approvalRequest.id);
  assert.equal(state.adminOperationLogs.some((item) => item.action === "points.adjust"), true);
});
