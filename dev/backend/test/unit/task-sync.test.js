process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const platform = require("../../src/services/task-platform-client");
const { submitTask, syncSubmission, processTaskCallback } = require("../../src/services/task-service");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const { createTaskSweep } = require("../../src/services/task-sweep-service");
const { createException } = require("../../src/domain/exception-rules");

async function setup(t) {
  const state = createSeed();
  const user = state.users[0];
  let rows = [];
  let reads = 0;
  t.mock.method(platform, "isConfigured", () => true);
  t.mock.method(platform, "post", async (endpoint, payload) => {
    if (endpoint.endsWith("task_info")) return { id: "remote", title: "Remote", users_ratio: "4.2", option: ["mobile"] };
    if (endpoint.endsWith("task_register")) return {};
    if (endpoint.endsWith("get_examine_list")) { reads++; return Number(payload.page) === 1 ? rows : []; }
    assert.fail(endpoint);
  });
  const submission = (await submitTask(state, user, "remote", { mobile: "13800138000" })).submission;
  const row = { id: "external", task_id: "remote", sf_uid: user.id, mobile: "13800138000", status: 1, createtime: submission.createdAt };
  return { state, user, submission, row, setRows(value) { rows = value; }, reads: () => reads };
}

test("sync closes only matching association exceptions and persists their tickets", async t => {
  const { state, user, submission, row, setRows } = await setup(t);
  row.status = 0; setRows([row]);
  const add = (type, bizNo, userId = user.id) => createException(state, { type, bizNo, action: "核对关联", payload: { userId } });
  const uncertain = add("task_submit_uncertain", submission.id);
  const mapping = add("task_callback_mapping_ambiguous", row.id);
  const unrelated = add("task_callback_data_missing", submission.id);
  const foreign = add("task_callback_mapping_ambiguous", row.id, state.users.find(item => item.id !== user.id).id);
  assert.equal((await syncSubmission(state, user.id, submission.id)).ok, true);
  assert.equal(submission.status, "reviewing");
  assert.equal(uncertain.status, "resolved"); assert.equal(mapping.status, "resolved");
  assert.equal(unrelated.status, "pending"); assert.equal(foreign.status, "pending");
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tgg-task-tickets-")), "state.sqlite");
  saveSQLiteState(state, db);
  const restored = loadSQLiteState(db);
  for (const exception of [uncertain, mapping]) assert.equal(restored.operationTickets.find(item => item.linkedId === exception.id).status, "resolved");
  // Recover a historical partial close on an idempotent retry.
  const ticket = state.operationTickets.find(item => item.linkedId === uncertain.id);
  ticket.status = "open";
  await syncSubmission(state, user.id, submission.id);
  assert.equal(ticket.status, "resolved");
});

test("reward failure leaves association tickets open until successful callback retry", async t => {
  const { state, user, submission, row, setRows } = await setup(t);
  setRows([row]);
  const exception = createException(state, { type: "task_submit_uncertain", bizNo: submission.id, payload: { userId: user.id } });
  const reward = submission.taskSnapshot.rewardPoints;
  submission.taskSnapshot.rewardPoints = null;
  assert.equal((await syncSubmission(state, user.id, submission.id)).status, 409);
  const ticket = state.operationTickets.find(item => item.linkedId === exception.id);
  assert.equal(exception.status, "pending"); assert.equal(ticket.status, "open");
  submission.taskSnapshot.rewardPoints = reward;
  assert.equal((await processTaskCallback(state, { id: row.id, sf_uid: user.id, status: 1 })).ok, true);
  assert.equal(exception.status, "resolved"); assert.equal(ticket.status, "resolved");
  const before = JSON.stringify(ticket);
  assert.equal((await processTaskCallback(state, { id: row.id, sf_uid: user.id, status: 1 })).idempotent, true);
  assert.equal(JSON.stringify(ticket), before);
});

test("callback records sanitized durable receipt and result for audit", async t => {
  const { state, submission, row } = await setup(t);
  const result = await processTaskCallback(state, { id: submission.id, sf_uid: userId(state, submission), status: 1, remarks: "通过" });
  assert.equal(result.ok, true);
  const receipt = state.adminOperationLogs.find(item => item.action === "task.callback.received");
  assert.equal(receipt.targetId, submission.id);
  assert.equal(receipt.after.result, "approved");
  assert.equal(receipt.after.remarks, "通过");
  assert.equal(receipt.adminId, null);
});

function userId(state, submission) { return submission.userId; }

test("lost callback can be recovered by trusted list lookup, concurrent refresh and later callback credit once", async t => {
  const { state, user, submission, row, setRows } = await setup(t);
  submission.submissionState = "unknown";
  const before = user.points;
  setRows([row]);
  const worker = createTaskSweep({ state: () => state, configured: () => true });
  const background = worker.run();
  const results = await Promise.all([syncSubmission(state, user.id, submission.id), syncSubmission(state, user.id, submission.id)]);
  assert.equal((await background).reconciled, 1);
  assert.ok(results.every(result => result.ok));
  assert.equal(submission.externalOrderId, "external");
  assert.equal(submission.submissionState, "submitted");
  assert.equal(submission.status, "approved");
  assert.equal(user.points, before + 42);
  assert.equal((await processTaskCallback(state, { id: row.id, sf_uid: user.id, status: 1 })).idempotent, true);
  assert.equal(user.points, before + 42);
  assert.equal(state.pointLedger.filter(item => item.bizNo === submission.id && item.changeType === "task_reward").length, 1);
  const database = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tgg-task-sync-")), "state.sqlite");
  saveSQLiteState(state, database);
  const reloaded = loadSQLiteState(database);
  assert.equal((await syncSubmission(reloaded, user.id, submission.id)).ok, true);
  assert.equal(reloaded.users.find(item => item.id === user.id).points, before + 42);
  assert.equal(reloaded.pointLedger.filter(item => item.bizNo === submission.id && item.changeType === "task_reward").length, 1);
});

test("rejected and still reviewing remote outcomes never grant rewards", async t => {
  const { state, user, submission, row, setRows } = await setup(t);
  const before = user.points;
  setRows([{ ...row, status: 0 }]);
  assert.equal((await syncSubmission(state, user.id, submission.id)).ok, true);
  assert.equal(submission.status, "reviewing");
  assert.equal(user.points, before);
  setRows([{ ...row, status: 2, remarks: "截图不完整" }]);
  assert.equal((await syncSubmission(state, user.id, submission.id)).submission.reasons, "截图不完整");
  assert.equal(submission.status, "rejected");
  assert.equal(user.points, before);
});

test("ambiguous, foreign and unknown-status results leave all business state unchanged", async t => {
  const { state, user, submission, row, setRows } = await setup(t);
  const before = JSON.stringify(state);
  for (const rows of [[], [row, { ...row, id: "second" }], [{ ...row, sf_uid: "foreign" }], [{ ...row, task_id: "other" }], [{ ...row, status: "invalid" }]]) {
    setRows(rows);
    assert.equal((await syncSubmission(state, user.id, submission.id)).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
  state.submissions.push({ ...submission, id: "similar-local" });
  setRows([row]);
  assert.equal((await syncSubmission(state, user.id, submission.id)).status, 409);
  assert.equal(submission.externalOrderId, null);
});

test("another user's record cannot trigger provider queries or reward changes", async t => {
  const { state, submission, reads } = await setup(t);
  assert.equal((await syncSubmission(state, "other-user", submission.id)).status, 404);
  assert.equal(reads(), 0);
});

test("provider timeout and incomplete page scan do not guess a unique external mapping", async t => {
  const { state, user, submission, row } = await setup(t);
  const before = JSON.stringify(state);
  t.mock.method(platform, "post", async () => { throw new Error("timeout"); });
  await assert.rejects(syncSubmission(state, user.id, submission.id), /timeout/);
  assert.equal(JSON.stringify(state), before);
  let reads = 0;
  t.mock.method(platform, "post", async () => { reads++; return [row]; });
  assert.equal((await syncSubmission(state, user.id, submission.id)).status, 409);
  assert.equal(reads, 20);
  assert.equal(JSON.stringify(state), before);
});
