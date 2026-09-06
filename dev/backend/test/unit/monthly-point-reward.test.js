process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const {
  buildMonthlyPointRewardOverview,
  reverseMonthlyPointReward,
  settleMonthlyPointRewards
} = require("../../src/services/monthly-point-reward-service");
const {
  approveApprovalRequest,
  requestApproval
} = require("../../src/services/admin-service");

test("monthly point rewards settle highest eligible tier once", () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1001");
  user.points = 1000;
  state.pointLedger.unshift(
    {
      id: "pt_a",
      userId: user.id,
      changeType: "task_reward",
      direction: "in",
      points: 500,
      balanceAfter: 3100,
      bizNo: "biz_a",
      idempotencyKey: "biz_a",
      createdAt: "2026-08-05T10:00:00.000Z"
    },
    {
      id: "pt_b",
      userId: user.id,
      changeType: "invite_commission",
      direction: "in",
      points: 650,
      balanceAfter: 3750,
      bizNo: "biz_b",
      idempotencyKey: "biz_b",
      createdAt: "2026-08-20T10:00:00.000Z"
    }
  );

  const overview = buildMonthlyPointRewardOverview(state, { monthKey: "2026-08" });
  const row = overview.rows.find((item) => item.userId === user.id);
  assert.equal(row.threshold, 1000);
  assert.equal(row.rewardPoints, 300);

  const result = settleMonthlyPointRewards(state, { now: "2026-09-02T00:10:00.000Z" });
  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 1);
  assert.equal(state.monthlyPointRewardSettlements.length, 1);
  assert.equal(state.pointLedger[0].changeType, "monthly_reward");
  assert.equal(state.pointLedger[0].points, 300);
  assert.equal(state.pointLedger[0].idempotencyKey, "monthly_reward:2026-08:u_1001");

  const second = settleMonthlyPointRewards(state, { now: "2026-09-02T00:10:00.000Z" });
  assert.equal(second.appliedCount, 0);
  assert.equal(state.monthlyPointRewardSettlements.length, 1);
});

test("monthly point reward overview filters and reversal writes recovery ledger", () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1001");
  user.points = 1000;
  state.pointLedger.unshift({
    id: "pt_a",
    userId: user.id,
    changeType: "task_reward",
    direction: "in",
    points: 1200,
    balanceAfter: 2200,
    bizNo: "biz_a",
    idempotencyKey: "biz_a",
    createdAt: "2026-08-05T10:00:00.000Z"
  });

  settleMonthlyPointRewards(state, { now: "2026-09-02T00:10:00.000Z" });
  const settlement = state.monthlyPointRewardSettlements[0];
  assert.equal(settlement.threshold, 1000);

  const settledOverview = buildMonthlyPointRewardOverview(state, {
    monthKey: "2026-08",
    threshold: "1000",
    settled: "settled"
  });
  assert.equal(settledOverview.rows.length, 1);
  assert.equal(settledOverview.settlements.length, 1);

  const result = reverseMonthlyPointReward(state, settlement.id, {
    now: "2026-09-03T10:00:00.000Z",
    reason: "test reversal",
    actor: { role: { id: "super_admin" } }
  });
  assert.equal(result.ok, true);
  assert.equal(user.points, 1000);
  assert.equal(state.pointLedger[0].changeType, "monthly_reward_reversal");
  assert.equal(state.pointLedger[0].direction, "out");
  assert.equal(state.pointLedger[0].points, 300);
  assert.equal(state.monthlyPointRewardSettlements[0].status, "reversed");

  const reversedOverview = buildMonthlyPointRewardOverview(state, {
    monthKey: "2026-08",
    settled: "reversed"
  });
  assert.equal(reversedOverview.rows.length, 0);
  assert.equal(reversedOverview.settlements.length, 1);
  assert.equal(reversedOverview.settlements[0].status, "reversed");
});

test("monthly reward reversal goes through approval queue before execution", () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1001");
  user.points = 1000;
  state.pointLedger.unshift({
    id: "pt_a",
    userId: user.id,
    changeType: "task_reward",
    direction: "in",
    points: 1200,
    balanceAfter: 2200,
    bizNo: "biz_a",
    idempotencyKey: "biz_a",
    createdAt: "2026-08-05T10:00:00.000Z"
  });

  settleMonthlyPointRewards(state, { now: "2026-09-02T00:10:00.000Z" });
  const settlement = state.monthlyPointRewardSettlements[0];

  const requestResult = requestApproval(state, {
    action: "monthly_reward.reverse",
    targetType: "monthly_reward",
    targetId: settlement.id,
    reason: "approval flow test"
  }, {
    role: { id: "finance_admin" }
  });
  assert.equal(requestResult.ok, true);
  assert.equal(state.adminApprovalRequests.length, 1);
  assert.equal(state.adminApprovalRequests[0].status, "pending");

  const approveResult = approveApprovalRequest(state, requestResult.approvalRequest.id, {
    role: { id: "audit_ops", permissions: ["approval:review"] }
  }, "approve reversal");
  assert.equal(approveResult.ok, true);
  assert.equal(state.adminApprovalRequests[0].status, "executed");
  assert.equal(state.monthlyPointRewardSettlements[0].status, "reversed");
  assert.equal(state.pointLedger[0].changeType, "monthly_reward_reversal");
  assert.equal(state.pointLedger[0].direction, "out");
});
