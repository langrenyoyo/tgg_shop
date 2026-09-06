const { nextId, saveState } = require("../data/store");
const { isMember } = require("../domain/rules");
const { handleTaskCallback } = require("../domain/task-callback-rules");
const taskRepository = require("../repositories/task-repository");
const taskPlatform = require("./task-platform-client");

async function listTaskTypes(state) {
  if (taskPlatform.isConfigured()) {
    const rows = await taskPlatform.post("index/index/task_type");
    return rows.map(taskPlatform.normalizeTaskType);
  }
  return taskRepository.listTypes(state);
}

async function listTasksForUser(state, query = {}) {
  if (taskPlatform.isConfigured()) {
    const rows = await taskPlatform.post("index/index/task_list", {
      page: query.page || 1,
      count: query.count || 10,
      search: query.search,
      c_id: query.c_id || query.category
    });
    return rows.map(taskPlatform.normalizeTaskListItem);
  }
  return taskRepository.listForUser(state, query);
}

async function getTaskDetail(state, taskId) {
  if (taskPlatform.isConfigured()) {
    const row = await taskPlatform.post("index/index/task_info", { id: taskId });
    return taskPlatform.normalizeTaskDetail(row);
  }
  return normalizeLocalTaskDetail(taskRepository.findById(state, taskId));
}

async function submitTask(state, user, taskId, payload) {
  if (!isMember(user)) return { ok: false, status: 403, error: "做任务交单需要先开通月会员" };
  const task = await getTaskDetail(state, taskId);
  if (!task) return { ok: false, status: 404, error: "任务不存在" };
  if (task.paused || task.status === "paused") return { ok: false, status: 400, error: "任务已暂停，暂不可提交" };

  const now = new Date().toISOString();
  const submissionId = nextId("sub");
  const normalizedPayload = normalizeSubmitPayload(payload);
  let platformResult = null;
  if (taskPlatform.isConfigured()) {
    platformResult = await taskPlatform.post("index/index/task_register", {
      task_id: taskId,
      sf_uid: user.id,
      ...normalizedPayload
    });
  }

  const submission = {
    id: submissionId,
    externalOrderId: String(platformResult?.id || platformResult?.order_id || platformResult?.examine_id || submissionId),
    taskId: task.id,
    taskSnapshot: {
      id: task.id,
      title: task.title,
      rewardPoints: task.rewardPoints,
      category: task.category || "",
      categoryId: task.categoryId || "",
      option: task.option || task.submitFields || [],
      submitFields: task.submitFields || task.option || []
    },
    userId: user.id,
    status: "reviewing",
    payload: normalizedPayload,
    platform: taskPlatform.isConfigured() ? "bounty_platform" : "local_mock",
    createdAt: now,
    updatedAt: now
  };
  taskRepository.addSubmission(state, submission);
  saveState();
  return { ok: true, submission };
}

async function listUserSubmissions(state, userId, query = {}) {
  if (taskPlatform.isConfigured()) {
    const rows = await taskPlatform.post("index/index/get_examine_list", {
      page: query.page || 1,
      status: query.status || "All",
      sf_uid: userId
    });
    return rows.map(taskPlatform.normalizeExamine);
  }
  return taskRepository.listSubmissionsByUser(state, userId, query).map((submission) => withTaskSummary(state, submission));
}

async function getSubmissionDetail(state, userId, submissionId) {
  if (taskPlatform.isConfigured()) {
    const row = await taskPlatform.post("index/index/get_examine_info", { id: submissionId, sf_uid: userId });
    return taskPlatform.normalizeTaskDetail(row);
  }
  const submission = taskRepository.findSubmission(state, submissionId, userId);
  if (!submission || submission.userId !== userId) return null;
  return withTaskSummary(state, submission);
}

function processTaskCallback(state, payload) {
  return handleTaskCallback(state, payload);
}

function getPlatformStatus() {
  return {
    mode: taskPlatform.isConfigured() ? "platform_proxy" : "local_mock",
    endpoints: [
      "index/index/task_type",
      "index/index/task_list",
      "index/index/task_info",
      "index/index/task_register",
      "index/index/get_examine_list",
      "/index/index/get_examine_info"
    ]
  };
}

function normalizeLocalTaskDetail(task) {
  if (!task) return null;
  return {
    ...task,
    submitFields: task.submitFields || task.option || [],
    option: task.option || task.submitFields || [],
    paused: task.status === "paused"
  };
}

function normalizeSubmitPayload(payload = {}) {
  return {
    name: payload.name || "",
    mobile: payload.mobile || payload.phone || "",
    text1: payload.text1 || payload.remark || "",
    text2: payload.text2 || "",
    images: payload.images || payload.imgea || payload.screenshot || "",
    raw: payload
  };
}

function withTaskSummary(state, submission) {
  const task = taskRepository.findById(state, submission.taskId) || submission.taskSnapshot || {};
  return {
    ...submission,
    taskTitle: task?.title || submission.taskId,
    rewardPoints: task?.rewardPoints || 0,
    reasons: submission.remarks || submission.reasons || ""
  };
}

module.exports = {
  listTaskTypes,
  listTasksForUser,
  getTaskDetail,
  submitTask,
  listUserSubmissions,
  getSubmissionDetail,
  getPlatformStatus,
  processTaskCallback
};
