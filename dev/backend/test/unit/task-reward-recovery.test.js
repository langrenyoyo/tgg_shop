process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSeed } = require("../../src/data/seed");
const { submitTask } = require("../../src/services/task-service");
const { handleTaskCallback } = require("../../src/domain/task-callback-rules");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");

async function setup() {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1002");
  user.memberUntil = new Date(Date.now() + 86400000).toISOString();
  const submission = (await submitTask(state, user, "task_001", { mobile: "13800138000", images: "https://example.com/proof.png" })).submission;
  return { state, user, submission, inviter: state.users.find(item => item.id === "u_1001") };
}

for (const missing of ["task_reward", "invite_commission", "neither"]) {
  test(`retry repairs stale review state with ${missing} ledger missing and never duplicates durable credits`, async () => {
    const { state, user, inviter, submission } = await setup();
    assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).ok, true);
    const expected = [user.points, inviter.points];
    const removed = state.pointLedger.find(item => item.bizNo === submission.id && item.changeType === missing);
    if (removed) {
      state.pointLedger = state.pointLedger.filter(item => item !== removed);
      state.users.find(item => item.id === removed.userId).points -= removed.points;
    }
    submission.status = "reviewing";
    const database = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tgg-reward-recovery-")), "state.sqlite");
    saveSQLiteState(state, database);
    const reloaded = loadSQLiteState(database);
    assert.equal(handleTaskCallback(reloaded, { id: submission.id, status: 2 }).status, 409);
    const result = handleTaskCallback(reloaded, { id: submission.id, status: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.submission.status, "approved");
    assert.deepEqual([user.id, inviter.id].map(id => reloaded.users.find(item => item.id === id).points), expected);
    assert.equal(reloaded.pointLedger.filter(item => item.bizNo === submission.id).length, 2);
    assert.equal(handleTaskCallback(reloaded, { id: submission.id, status: 1 }).idempotent, true);
    assert.deepEqual([user.id, inviter.id].map(id => reloaded.users.find(item => item.id === id).points), expected);
  });
}

test("invalid or overflowing recipient balances reject before any reward mutation", async () => {
  for (const target of ["user", "inviter"]) {
    for (const points of ["100", -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      const context = await setup();
      context[target].points = points;
      const before = JSON.stringify(context.state);
      assert.equal(handleTaskCallback(context.state, { id: context.submission.id, status: 1 }).status, 409);
      assert.equal(JSON.stringify(context.state), before);
    }
  }
});

test("conflicting durable reward evidence requires reconciliation instead of repairing silently", async () => {
  const { state, submission } = await setup();
  handleTaskCallback(state, { id: submission.id, status: 1 });
  state.pointLedger.find(item => item.bizNo === submission.id && item.changeType === "task_reward").points += 1;
  submission.status = "reviewing";
  const before = JSON.stringify(state);
  assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).status, 409);
  assert.equal(JSON.stringify(state), before);
});

test("malformed reward snapshots cannot approve a submission or create zero-point evidence", async () => {
  for (const reward of [null, undefined, "", "  ", false, true, [], {}, "0x10", "1e2"]) {
    const { state, submission } = await setup();
    submission.taskSnapshot.rewardPoints = reward;
    const before = JSON.stringify(state);
    assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).status, 409);
    assert.equal(JSON.stringify(state), before);
  }
  for (const snapshot of [{}, { rewardPoints: 10, rewardValid: false }]) {
    const { state, submission } = await setup();
    submission.taskSnapshot = snapshot;
    const before = JSON.stringify(state);
    assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).status, 409);
    assert.equal(JSON.stringify(state), before);
  }
});

test("explicit zero and historical decimal-string rewards remain supported", async () => {
  for (const snapshot of [{ rewardPoints: 0 }, { rewardPoints: "42.0" }, { usersRatio: "42" }]) {
    const { state, submission, user } = await setup();
    submission.taskSnapshot = snapshot;
    const before = user.points;
    assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).ok, true);
    assert.equal(user.points, before + Number(snapshot.rewardPoints ?? snapshot.usersRatio));
    assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).idempotent, true);
  }
});

test("duplicate idempotency evidence is not treated as a successful replay", async () => {
  const { state, submission } = await setup();
  handleTaskCallback(state, { id: submission.id, status: 1 });
  state.pointLedger.push({ ...state.pointLedger.find(item => item.bizNo === submission.id), id: "duplicate" });
  const before = JSON.stringify(state);
  assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).status, 409);
  assert.equal(JSON.stringify(state), before);
});
