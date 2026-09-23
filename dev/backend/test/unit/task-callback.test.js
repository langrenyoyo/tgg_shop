process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { submitTask, processTaskCallback } = require("../../src/services/task-service");
const { handleTaskCallback } = require("../../src/domain/task-callback-rules");
const taskPlatform = require("../../src/services/task-platform-client");

test("approved task callback grants points once", async () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  user.memberUntil = new Date(Date.now() + 86400000).toISOString();
  const inviter = state.users.find((item) => item.id === "u_1001");
  const before = user.points;
  const inviterBefore = inviter.points;
  const submission = (await submitTask(state, user, "task_001", { phone: "13900000000", screenshot: "https://example.com/proof.png" })).submission;

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
  const submission = (await submitTask(state, user, "task_002", { account: "demo", screenshot: "https://example.com/proof.png" })).submission;

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

test("platform task submission keeps snapshot for callback approval", async () => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  user.memberUntil = new Date(Date.now() + 86400000).toISOString();
  state.tasks = [];

  const originalIsConfigured = taskPlatform.isConfigured;
  const originalPost = taskPlatform.post;
  taskPlatform.isConfigured = () => true;
  taskPlatform.post = async (endpoint) => {
    if (endpoint === "index/index/task_info") {
      return {
        id: "platform_001",
        title: "平台任务",
        reward: "4.20",
        users_ratio: "4.20",
        content: [],
        option: ["name", "mobile", "images"],
        is_pause: 0
      };
    }
    if (endpoint === "index/index/task_register") {
      return { id: "ext_001" };
    }
    if (endpoint === "index/index/task_list") {
      return [{
        id: "platform_001",
        title: "平台任务",
        image: "",
        c_name: "简单注册",
        option: ["name", "mobile", "images"],
        is_pause: 0,
        reward: "4.20",
        users_ratio: "4.20"
      }];
    }
    if (endpoint === "index/index/task_type") {
      return [];
    }
    return null;
  };

  try {
    const submission = (await submitTask(state, user, "platform_001", {
      name: "测试用户",
      mobile: "13800138000",
      images: "https://example.com/a.png"
    })).submission;

    assert.equal(submission.platform, "bounty_platform");
    assert.ok(submission.taskSnapshot);
    submission.taskSnapshot.rewardPoints = 42;

    const before = user.points;
    const result = handleTaskCallback(state, { submissionId: submission.id, status: 1, remarks: "platform pass" });
    assert.equal(result.ok, true);
    assert.equal(user.points, before + 42);
    assert.equal(state.pointLedger.some((item) => item.changeType === "task_reward" && item.bizNo === submission.id), true);
  } finally {
    taskPlatform.isConfigured = originalIsConfigured;
    taskPlatform.post = originalPost;
  }
});

test("platform invitation allocation is used for the inviter commission", async t => {
  const state = createSeed();
  const user = state.users.find((item) => item.id === "u_1002");
  user.memberUntil = new Date(Date.now() + 86400000).toISOString();
  const inviter = state.users.find((item) => item.id === "u_1001");
  const originalIsConfigured = taskPlatform.isConfigured;
  const originalPost = taskPlatform.post;
  taskPlatform.isConfigured = () => true;
  taskPlatform.post = async endpoint => {
    if (endpoint.endsWith("task_info")) return {
      id: "ratio_task", title: "按任务比例结算", reward: "10.00", users_ratio: "10.00",
      invitation_ratio: "2.00", option: ["mobile"], is_pause: 0
    };
    if (endpoint.endsWith("task_register")) return {};
    throw new Error("Unexpected endpoint");
  };
  try {
    const submission = (await submitTask(state, user, "ratio_task", { mobile: "13800138000" })).submission;
    assert.equal(submission.taskSnapshot.inviteCommissionPoints, 20);
    const before = inviter.points;
    assert.equal(handleTaskCallback(state, { submissionId: submission.id, status: 1 }).ok, true);
    assert.equal(inviter.points, before + 20);
  } finally {
    taskPlatform.isConfigured = originalIsConfigured;
    taskPlatform.post = originalPost;
  }
});

test("failed reward validation leaves review retryable and snapshot wins over edited task", async () => {
  const state = createSeed();
  const user = state.users[0];
  const submission = (await submitTask(state, user, "task_001", { mobile: "13800138000", images: "https://example.com/proof.png" })).submission;
  const before = user.points;
  state.tasks.find(item => item.id === submission.taskId).rewardPoints = 999;
  const snapshot = submission.taskSnapshot;
  submission.taskSnapshot = { ...snapshot, rewardPoints: -1 };
  assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).ok, false);
  assert.equal(submission.status, "reviewing");
  assert.equal(user.points, before);
  submission.taskSnapshot = snapshot;
  assert.equal(handleTaskCallback(state, { id: submission.id, status: 1 }).ok, true);
  assert.equal(user.points, before + snapshot.rewardPoints);
  assert.equal(handleTaskCallback(state, { id: submission.id, status: 2 }).status, 409);
  assert.equal(submission.status, "approved");
});

test("documented empty register response reconciles by platform order and payload", async t => {
  const state = createSeed();
  const user = state.users[0];
  const originalConfigured = taskPlatform.isConfigured;
  const originalPost = taskPlatform.post;
  t.after(() => { taskPlatform.isConfigured = originalConfigured; taskPlatform.post = originalPost; });
  taskPlatform.isConfigured = () => true;
  taskPlatform.post = async endpoint => {
    if (endpoint.endsWith("task_info")) return { id: "ext_task", title: "平台任务", users_ratio: "4.2", option: ["mobile"] };
    if (endpoint.endsWith("task_register")) return {};
    if (endpoint.endsWith("get_examine_list")) return [{ id: "review_1", task_id: "ext_task", sf_uid: user.id, mobile: "13800138000", status: 1, createtime: new Date().toISOString() }];
    throw new Error("Unexpected endpoint");
  };
  const submission = (await submitTask(state, user, "ext_task", { mobile: "13800138000" })).submission;
  assert.equal(submission.externalOrderId, null);
  const before = user.points;
  const result = await processTaskCallback(state, { id: "review_1", sf_uid: user.id, status: 1 });
  assert.equal(result.ok, true);
  assert.equal(submission.externalOrderId, "review_1");
  assert.equal(user.points, before + 42);
  assert.equal((await processTaskCallback(state, { id: "review_1", sf_uid: user.id, status: 1 })).idempotent, true);
});

test("callback cannot resolve a local submission for the wrong user", async () => {
  const state = createSeed();
  const user = state.users[0];
  const submission = (await submitTask(state, user, "task_001", { mobile: "13800138000", images: "https://example.com/proof.png" })).submission;
  const before = user.points;
  assert.equal(handleTaskCallback(state, { id: submission.id, sf_uid: "someone_else", status: 1 }).status, 404);
  assert.equal(user.points, before);
});
