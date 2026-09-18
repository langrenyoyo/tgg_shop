process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const platform = require("../../src/services/task-platform-client");
const service = require("../../src/services/task-service");

test("linked platform reviews retain local navigation, reward snapshot and settlement status", async t => {
  t.mock.method(platform, "isConfigured", () => true);
  t.mock.method(platform, "post", async () => [
    { id: 71, sf_uid: "alice", task_id: 42, status: 1 },
    { id: 72, sf_uid: "bob", task_id: 42, status: 1 }
  ]);
  const state = createSeed();
  state.tasks = [{ id: "42", rewardPoints: 999 }];
  state.submissions = [{ id: "sub-local", userId: "alice", taskId: "42", externalOrderId: "71", platform: "bounty_platform", status: "reviewing", taskSnapshot: { title: "Original task", rewardPoints: 23 } }];
  const before = JSON.stringify(state);
  const rows = await service.listUserSubmissions(state, "alice");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "sub-local");
  assert.equal(rows[0].platformStatus, "approved");
  assert.equal(rows[0].status, "reviewing");
  assert.equal(rows[0].rewardPoints, 23);
  assert.equal((await service.getSubmissionDetail(state, "alice", rows[0].id)).platform, "bounty_platform");
  assert.equal(JSON.stringify(state), before);
});

test("remote review detail uses order and user identity, never the ambiguous task-detail endpoint", async t => {
  t.mock.method(platform, "isConfigured", () => true);
  const pages = [];
  t.mock.method(platform, "post", async (endpoint, body) => {
    assert.equal(endpoint, "index/index/get_examine_list");
    assert.equal(body.sf_uid, "alice");
    pages.push(body.page);
    return body.page === 1 ? [{ id: 71, sf_uid: "bob", status: 1 }] : [{ id: 71, sf_uid: "alice", task_id: 42, status: 2, reasons: "proof rejected" }];
  });
  const detail = await service.getSubmissionDetail(createSeed(), "alice", "71");
  assert.deepEqual(pages, [1, 2]);
  assert.equal(detail.id, "71");
  assert.equal(detail.taskId, "42");
  assert.equal(detail.status, "rejected");
  assert.equal(detail.reasons, "proof rejected");
});

test("review lookup distinguishes absent records from provider failures", async t => {
  t.mock.method(platform, "isConfigured", () => true);
  t.mock.method(platform, "post", async () => []);
  assert.equal(await service.getSubmissionDetail(createSeed(), "alice", "missing"), null);
  platform.post = async () => { throw Object.assign(new Error("timeout"), { status: 504 }); };
  await assert.rejects(service.getSubmissionDetail(createSeed(), "alice", "missing"), { status: 504 });
});
