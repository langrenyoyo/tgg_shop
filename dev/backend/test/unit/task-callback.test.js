process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { submitTask } = require("../../src/services/task-service");
const { handleTaskCallback } = require("../../src/domain/task-callback-rules");

test("approved task callback grants points once", async () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  user.memberUntil = new Date(Date.now() + 86400000).toISOString();
  const inviter = state.users.find((item) => item.id === "u_1001");
  const before = user.points;
  const inviterBefore = inviter.points;
  const submission = (await submitTask(state, user, "task_001", { phone: "13900000000" })).submission;

  const result = handleTaskCallback(state, { id: submission.id, status: 1, remarks: "通过" });
  assert.equal(result.ok, true);
  assert.equal(submission.status, "approved");
  assert.equal(user.points, before + 119);
  assert.equal(inviter.points, inviterBefore + 11);
  assert.equal(state.pointLedger.some((item) => item.changeType === "task_reward" && item.bizNo === submission.id), true);
  assert.equal(state.pointLedger.some((item) => item.changeType === "invite_commission" && item.bizNo === submission.id), true);

  const duplicate = handleTaskCallback(state, { id: submission.id, status: 1, remarks: "重复通过" });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(user.points, before + 119);
  assert.equal(inviter.points, inviterBefore + 11);
  assert.equal(state.pointLedger.filter((item) => item.changeType === "task_reward" && item.bizNo === submission.id).length, 1);
  assert.equal(state.pointLedger.filter((item) => item.changeType === "invite_commission" && item.bizNo === submission.id).length, 1);
});

test("rejected task callback updates submission without points", async () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  user.memberUntil = new Date(Date.now() + 86400000).toISOString();
  const before = user.points;
  const submission = (await submitTask(state, user, "task_002", { account: "demo" })).submission;

  const result = handleTaskCallback(state, { submissionId: submission.id, status: 2, remarks: "资料不完整" });
  assert.equal(result.ok, true);
  assert.equal(submission.status, "rejected");
  assert.equal(submission.remarks, "资料不完整");
  assert.equal(user.points, before);
});

test("missing submission callback creates exception", () => {
  const state = createSeed();
  const result = handleTaskCallback(state, { id: "missing_submission", status: 1, remarks: "通过" });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(state.exceptions[0].type, "task_callback_submission_missing");
});
