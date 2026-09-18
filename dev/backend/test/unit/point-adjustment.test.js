process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { requestApproval, approveApprovalRequest } = require("../../src/services/admin-service");
const requester = { role: { id: "support" } }, reviewer = { role: { id: "finance" } };
const input = pointsDelta => ({ action: "points.adjust", targetType: "user", targetId: "u_1001", payload: { pointsDelta }, reason: "核对原始业务凭据后补偿" });

test("invalid manual adjustment amounts cannot create approval or mutate balances", () => {
  for (const delta of [1.5, -1.5, 0, null, true, [], "1.5", "1e2", "0x10", "", Number.MAX_SAFE_INTEGER + 1]) {
    const state = createSeed(), before = JSON.stringify(state);
    assert.equal(requestApproval(state, input(delta), requester).status, 400);
    assert.equal(JSON.stringify(state), before);
  }
});

test("invalid current balance, insufficient funds and overflow require accounting review", () => {
  for (const [balance, delta] of [["100", 1], [-1, 1], [10, -11], [Number.MAX_SAFE_INTEGER, 1]]) {
    const state = createSeed(); state.users.find(user => user.id === "u_1001").points = balance;
    const before = JSON.stringify(state);
    assert.equal(requestApproval(state, input(delta), requester).status, 409);
    assert.equal(JSON.stringify(state), before);
  }
});

test("different pending adjustment conflicts while the same normalized amount replays", () => {
  const state = createSeed();
  const first = requestApproval(state, input(10), requester);
  assert.equal(first.ok, true);
  assert.equal(requestApproval(state, input("+10"), requester).approvalRequest.id, first.approvalRequest.id);
  const before = JSON.stringify(state);
  assert.equal(requestApproval(state, input(20), requester).status, 409);
  assert.equal(JSON.stringify(state), before);
});

test("approval execution revalidates changed balance before posting any ledger", () => {
  const state = createSeed();
  const approval = requestApproval(state, input(-10), requester).approvalRequest;
  const user = state.users.find(user => user.id === "u_1001"); user.points = 5;
  const count = state.pointLedger.length;
  assert.equal(approveApprovalRequest(state, approval.id, reviewer, "复核").status, 409);
  assert.equal(user.points, 5); assert.equal(state.pointLedger.length, count);
  assert.equal(approval.status, "failed");
});

test("valid reviewed adjustment produces exact balance and audited ledger once", () => {
  const state = createSeed();
  const user = state.users.find(user => user.id === "u_1001"), before = user.points;
  const approval = requestApproval(state, input(-10), requester).approvalRequest;
  assert.equal(approveApprovalRequest(state, approval.id, reviewer, "凭据复核通过").ok, true);
  assert.equal(user.points, before - 10);
  assert.equal(state.pointLedger.filter(row => row.bizNo === approval.id).length, 1);
  assert.equal(state.adminOperationLogs.some(row => row.action === "points.adjust"), true);
  assert.equal(approveApprovalRequest(state, approval.id, reviewer, "重复").ok, false);
  assert.equal(user.points, before - 10);
});

test("explicit approval key replays executed history and rejects another intent without mutation", () => {
  const state = createSeed();
  const original = { ...input(-10), idempotencyKey: "stable-adjustment" };
  const approval = requestApproval(state, original, requester).approvalRequest;
  approveApprovalRequest(state, approval.id, reviewer, "复核");
  state.users.find(user => user.id === "u_1001").points = 0;
  const before = JSON.stringify(state);
  assert.equal(requestApproval(state, original, requester).approvalRequest.id, approval.id);
  assert.equal(requestApproval(state, original, requester).idempotent, true);
  for (const changed of [{ ...original, payload: { pointsDelta: 20 } }, { ...original, targetId: "u_1002" }, { ...original, reason: "different" }]) assert.equal(requestApproval(state, changed, requester).status, 409);
  assert.equal(requestApproval(state, original, reviewer).status, 409);
  assert.equal(JSON.stringify(state), before);
});

test("distinct explicit key cannot silently attach to a pending approval", () => {
  const state = createSeed();
  requestApproval(state, { ...input(10), idempotencyKey: "first" }, requester);
  assert.equal(requestApproval(state, { ...input(10), idempotencyKey: "second" }, requester).status, 409);
  for (const idempotencyKey of ["", " ", 12, "a".repeat(129)]) assert.equal(requestApproval(state, { ...input(10), idempotencyKey }, requester).status, 400);
});
