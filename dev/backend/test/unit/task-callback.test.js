process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { submitTask } = require("../../src/services/task-service");
const { handleTaskCallback } = require("../../src/domain/task-callback-rules");
const taskPlatform = require("../../src/services/task-platform-client");

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
