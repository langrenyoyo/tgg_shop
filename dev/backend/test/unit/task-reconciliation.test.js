process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createSeed } = require("../../src/data/seed");
const platform = require("../../src/services/task-platform-client");
const { submitTask } = require("../../src/services/task-service");
const { reconcile } = require("../../src/services/task-reconciliation-service");
const { reviewTaskSubmission } = require("../../src/services/admin-service");
const { createException } = require("../../src/domain/exception-rules");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");
const actor = { adminId: "auditor", role: { id: "audit_ops" } };
async function setup(t) {
  const state = createSeed();
  t.mock.method(platform, "isConfigured", () => false);
  const submission = (await submitTask(state, state.users[0], "task_001", { mobile: "13800138000", images: "proof.png" })).submission;
  Object.assign(submission, { platform: "bounty_platform", externalOrderId: null, submissionState: "unknown" });
  t.mock.method(platform, "isConfigured", () => true);
  const row = { id: "platform-order", sf_uid: submission.userId, task_id: submission.taskId, status: 1 };
  t.mock.method(platform, "post", async (endpoint, payload) => {
    assert.equal(endpoint, "index/index/get_examine_list");
    assert.equal(payload.sf_uid, submission.userId);
    return payload.page === 1 ? [row] : [];
  });
  return { state, submission, row };
}
test("manual verified association restores reward, audit and linked exceptions once across SQLite reload", async t => {
  const { state, submission, row } = await setup(t);
  const exception = createException(state, { type: "task_submit_uncertain", bizNo: submission.id, payload: { userId: submission.userId } });
  const input = { externalOrderId: row.id, reason: "人工比对平台提交资料，已确认归属" };
  const user = state.users.find(item => item.id === submission.userId), before = user.points;
  assert.equal((await reconcile(state, submission.id, input, actor)).ok, true);
  assert.equal(submission.status, "approved"); assert.equal(user.points, before + submission.taskSnapshot.rewardPoints);
  assert.equal(exception.status, "resolved");
  assert.equal(state.operationTickets.find(item => item.linkedId === exception.id).status, "resolved");
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tgg-task-reconcile-")), "state.sqlite");
  saveSQLiteState(state, db); const reloaded = loadSQLiteState(db);
  assert.equal((await reconcile(reloaded, submission.id, input, actor)).ok, true);
  assert.equal(reloaded.users.find(item => item.id === user.id).points, user.points);
  assert.equal(reloaded.adminOperationLogs.filter(item => item.action === "task.reconcile").length, 1);
});
test("pending provider review resolves registration uncertainty without approving or crediting", async t => {
  const { state, submission, row } = await setup(t);
  row.status = 0;
  const exception = createException(state, { type: "task_submit_uncertain", bizNo: submission.id, payload: { userId: submission.userId } });
  const user = state.users.find(item => item.id === submission.userId);
  const before = user.points, ledgerCount = state.pointLedger.length;
  const result = await reconcile(state, submission.id, { externalOrderId: row.id, reason: "核对待审核交单" }, actor);
  assert.equal(result.ok, true);
  assert.equal(submission.status, "reviewing");
  assert.equal(submission.submissionState, "submitted");
  assert.equal(exception.status, "resolved");
  assert.equal(user.points, before);
  assert.equal(state.pointLedger.length, ledgerCount);
});

test("wrong platform user, task, status and missing reason leave state untouched", async t => {
  const { state, submission, row } = await setup(t);
  for (const override of [{ sf_uid: "other" }, { task_id: "other" }, { status: 8 }]) {
    const original = { ...row }; Object.assign(row, override);
    const before = JSON.stringify(state);
    assert.equal((await reconcile(state, submission.id, { externalOrderId: row.id, reason: "核对" }, actor)).ok, false);
    assert.equal(JSON.stringify(state), before); Object.assign(row, original);
  }
  assert.equal((await reconcile(state, submission.id, { externalOrderId: row.id }, actor)).status, 400);
  assert.equal(reviewTaskSubmission(state, submission.id, "approved", "manual", actor).status, 409);
});
test("concurrent association cannot bind one provider order to two submissions", async t => {
  const { state, submission, row } = await setup(t);
  const second = { ...submission, id: "second-local" }; state.submissions.push(second);
  const input = { externalOrderId: row.id, reason: "核对原始凭据" };
  const results = await Promise.all([reconcile(state, submission.id, input, actor), reconcile(state, second.id, input, actor)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  assert.equal(state.submissions.filter(item => item.externalOrderId === row.id).length, 1);
});
test("unauthenticated admin cannot access reconciliation or cause platform reads", async () => {
  let status;
  await handleAdminRoutes({ req: { method: "POST", headers: {} }, url: new URL("https://example.com/api/admin/task-submissions/local/reconcile"), state: createSeed(), readBody() { assert.fail("Must authenticate before reading input"); }, send: (res, code) => { status = code; } });
  assert.ok([401, 403].includes(status));
});
