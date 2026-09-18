const { nextId, saveState } = require("../data/store");
const { isMember } = require("../domain/rules");
const { handleTaskCallback } = require("../domain/task-callback-rules");
const taskRepository = require("../repositories/task-repository");
const taskPlatform = require("./task-platform-client");
const { createException } = require("../domain/exception-rules");
const { resolveTaskAssociationExceptions } = require("./task-exception-service");

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
    try {
      const row = await taskPlatform.post("index/index/task_info", { id: taskId });
      return taskPlatform.normalizeTaskDetail(row);
    } catch (error) { throw error; }
  }
  return normalizeLocalTaskDetail(taskRepository.findById(state, taskId));
}

async function submitTask(state, user, taskId, payload) {
  if (!isMember(user)) return { ok: false, status: 403, error: "做任务交单需要先开通月会员" };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, status: 400, error: "交单内容格式错误" };
  if (payload.idempotencyKey !== undefined && (typeof payload.idempotencyKey !== "string" || !payload.idempotencyKey.trim() || payload.idempotencyKey.length > 128)) return { ok: false, status: 400, error: "提交标识格式错误" };
  const normalizedPayload = normalizeSubmitPayload(payload);
  if (["name", "mobile", "text1", "text2", "images"].some(key => typeof normalizedPayload[key] !== "string")) return { ok: false, status: 400, error: "交单字段必须为文本，截图使用逗号分隔的图片地址" };
  const findPrevious = () => payload.idempotencyKey && state.submissions.find(item => item.userId === user.id && String(item.taskId) === String(taskId) && item.payload?.raw?.idempotencyKey === payload.idempotencyKey);
  const previous = findPrevious();
  if (previous) return replaySubmission(previous, payload);
  const task = await getTaskDetail(state, taskId);
  if (!task) return { ok: false, status: 404, error: "任务不存在" };
  if (task.paused || task.status === "paused") return { ok: false, status: 400, error: "任务已暂停，暂不可提交" };
  if (!Number.isSafeInteger(task.rewardPoints) || task.rewardPoints < 0) return { ok: false, status: 503, error: "任务奖励暂无法确认，请稍后重试" };
  const aliases = { name: "name", mobile: "mobile", phone: "mobile", text1: "text1", remark: "text1", text2: "text2", images: "images", imgea: "images", screenshot: "images" };
  const required = task.submitFields || task.option || [];
  if (!Array.isArray(required) || required.some(field => !Object.hasOwn(aliases, field))) return { ok: false, status: 503, error: "任务交单字段配置暂不支持，请联系管理员核对" };
  for (const field of required) {
    if (!normalizedPayload[aliases[field]].trim()) return { ok: false, status: 400, error: `请填写任务必填字段：${field}` };
  }
  // Another request may have registered this key while task details were loading.
  // No await may occur between this check and insertion of the local intent.
  const concurrent = findPrevious();
  if (concurrent) return replaySubmission(concurrent, payload);

  const now = new Date().toISOString();
  const submissionId = nextId("sub");
  const submission = {
    id: submissionId,
    externalOrderId: taskPlatform.isConfigured() ? null : submissionId,
    submissionState: taskPlatform.isConfigured() ? "sending" : "submitted",
    taskId: task.id,
    taskSnapshot: {
      id: task.id,
      title: task.title,
      rewardPoints: task.rewardPoints,
      inviteCommissionRate: Number(state.config.inviteCommissionRate || 0),
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
  // External tasks must also exist locally so relational stores can satisfy the
  // task_submission foreign key and retain a stable task snapshot.
  if (!taskRepository.findById(state, task.id)) {
    state.tasks.push({
      id: task.id,
      title: task.title || `External task ${task.id}`,
      category: task.category || "external",
      categoryId: task.categoryId || "external",
      rewardPoints: task.rewardPoints || 0,
      submitFields: task.submitFields || task.option || [],
      option: task.option || task.submitFields || [],
      status: task.paused ? "paused" : "active",
      source: "platform",
      createdAt: now,
      updatedAt: now
    });
  }
  taskRepository.addSubmission(state, submission);
  await saveState();
  if (taskPlatform.isConfigured()) {
    try {
      const { raw, ...fields } = normalizedPayload;
      const result = await taskPlatform.post("index/index/task_register", { task_id: taskId, sf_uid: user.id, ...fields });
      const externalId = result?.id || result?.order_id || result?.examine_id;
      if (externalId) submission.externalOrderId = String(externalId);
      submission.submissionState = "submitted";
    } catch (error) {
      submission.submissionState = "unknown";
      createException(state, { type: "task_submit_uncertain", bizNo: submission.id, action: "核对平台是否收单，确认前不要重复提交", payload: { userId: user.id, submissionId: submission.id } });
      await saveState();
      return { ok: false, status: 502, error: "提交结果待核对，请查看提交记录，勿重复交单" };
    }
    await saveState();
  }
  return { ok: true, submission };
}

async function replaySubmission(submission, payload) {
  const normalized = normalizeSubmitPayload(payload);
  if (["name", "mobile", "text1", "text2", "images"].some(key => String(submission.payload?.[key] || "") !== String(normalized[key] || ""))) {
    return { ok: false, status: 409, error: "该提交标识已用于其他内容，请先查看原提交记录" };
  }
  if (["sending", "unknown"].includes(submission.submissionState)) return { ok: false, status: 409, error: "提交结果待核对，请查看提交记录，勿重复交单" };
  await saveState();
  return { ok: true, submission, idempotent: true };
}

async function listUserSubmissions(state, userId, query = {}) {
  const status = ({ "0": "reviewing", "1": "approved", "2": "rejected" })[query.status] || query.status || "All";
  if (taskPlatform.isConfigured()) {
    const rows = await taskPlatform.post("index/index/get_examine_list", {
      page: query.page || 1,
      status: ({ reviewing: "0", approved: "1", rejected: "2" })[status] || "All",
      sf_uid: userId
    });
    if (!Array.isArray(rows)) throw Object.assign(new Error("任务平台审核列表格式异常"), { status: 502 });
    const remote = rows.filter(row => row && row.id != null && String(row.sf_uid) === String(userId)).map(row => {
      const local = state.submissions.find(item => item.platform === "bounty_platform" && item.externalOrderId != null && String(item.externalOrderId) === String(row.id) && String(item.userId) === String(userId) && String(item.taskId) === String(row.task_id));
      return local ? { ...withTaskSummary(state, local), platformStatus: taskPlatform.normalizeExamine(row).status } : taskPlatform.normalizeExamine(row);
    });
    if (Number(query.page || 1) === 1) {
      const pending = state.submissions.filter(item => item.userId === userId && item.platform === "bounty_platform" && !item.externalOrderId && (status === "All" || item.status === status)).map(item => withTaskSummary(state, item));
      return pending.concat(remote);
    }
    return remote;
  }
  return taskRepository.listSubmissionsByUser(state, userId, query).map((submission) => withTaskSummary(state, submission));
}

async function getSubmissionDetail(state, userId, submissionId) {
  const ownLocal = taskRepository.findSubmission(state, submissionId, userId);
  if (ownLocal && ownLocal.userId === userId) return withTaskSummary(state, ownLocal);
  if (taskPlatform.isConfigured()) {
    try {
      // The documented detail endpoint returns a task, not reliable review evidence.
      // Resolve remote order IDs against the authenticated user's review list.
      for (let page = 1; page <= 20; page += 1) {
        const rows = await taskPlatform.post("index/index/get_examine_list", { page, status: "All", sf_uid: userId });
        if (!Array.isArray(rows)) throw Object.assign(new Error("任务平台审核列表格式异常"), { status: 502 });
        const row = rows.find(item => item && String(item.id) === String(submissionId) && String(item.sf_uid) === String(userId));
        if (row) return taskPlatform.normalizeExamine(row);
        if (!rows.length) return null;
      }
      throw Object.assign(new Error("审核记录过多，请从本站交单记录进入或联系管理员核对"), { status: 409 });
    } catch (error) {
      throw error;
    }
  }
  const submission = taskRepository.findSubmission(state, submissionId, userId);
  if (!submission || submission.userId !== userId) return null;
  return withTaskSummary(state, submission);
}

async function processTaskCallback(state, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, status: 400, error: "回调参数格式错误" };
  const callbackLog = {
    adminId: null, roleId: "task_platform",
    id: nextId("tcb"), action: "task.callback.received", targetType: "task_platform_order",
    targetId: String(payload.id || payload.submissionId || ""), detail: {
      externalOrderId: String(payload.id || ""), userId: String(payload.sf_uid || ""), status: payload.status,
      remarks: typeof payload.remarks === "string" ? payload.remarks.slice(0, 500) : ""
    }, createdAt: new Date().toISOString()
  };
  callbackLog.after = callbackLog.detail;
  state.adminOperationLogs ||= [];
  state.adminOperationLogs.unshift(callbackLog);
  await saveState();
  if (!taskRepository.findSubmission(state, payload.submissionId || payload.id, payload.sf_uid) && taskPlatform.isConfigured() && payload.sf_uid && payload.id) {
    const matched = await reconcileCallback(state, payload);
    if (!matched.ok) { callbackLog.detail.result = matched.error; callbackLog.after = callbackLog.detail; await saveState(); return matched; }
  }
  const result = handleTaskCallback(state, payload);
  callbackLog.detail.result = result.ok ? (result.submission?.status || "success") : result.error;
  callbackLog.after = callbackLog.detail;
  if (result.ok) {
    resolveTaskAssociationExceptions(state, result.submission, "平台回调已确认交单关联并处理审核结果");
    await saveState();
  }
  await saveState();
  return result;
}

function matchingSubmissions(state, row, userId) {
  const platformDate = String(row?.createtime || "");
  const platformTime = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(platformDate) ? platformDate.replace(" ", "T") + "+08:00" : platformDate);
  return state.submissions.filter(item => !item.externalOrderId && item.platform === "bounty_platform" && String(item.userId) === String(userId) && String(item.taskId) === String(row.task_id) && Math.abs(Date.parse(item.createdAt) - platformTime) <= 300000 && ["name", "mobile", "text1", "text2", "images"].every(key => String(item.payload?.[key] || "").trim() === String(row[key] || "").trim()));
}

async function syncSubmission(state, userId, submissionId) {
  const submission = taskRepository.findSubmission(state, submissionId, userId);
  if (!submission || String(submission.userId) !== String(userId)) return { ok: false, status: 404, error: "提交记录不存在" };
  if (submission.platform !== "bounty_platform") return { ok: true, submission: withTaskSummary(state, submission) };
  if (!taskPlatform.isConfigured()) return { ok: false, status: 503, error: "任务平台未配置，暂不能核对审核结果" };
  const matched = new Map();
  let complete = false;
  for (let page = 1; page <= 20; page += 1) {
    const rows = await taskPlatform.post("index/index/get_examine_list", { page, status: "All", sf_uid: userId });
    if (!Array.isArray(rows)) return { ok: false, status: 502, error: "任务平台审核列表格式异常" };
    if (!rows.length) { complete = true; break; }
    for (const row of rows) {
      if (row.id == null || String(row.sf_uid) !== String(userId) || String(row.task_id) !== String(submission.taskId)) continue;
      if (submission.externalOrderId ? String(row.id) === String(submission.externalOrderId) : matchingSubmissions(state, row, userId).includes(submission)) matched.set(String(row.id), row);
    }
    if (submission.externalOrderId && matched.size === 1) { complete = true; break; }
  }
  if (!complete) return { ok: false, status: 409, error: "审核记录过多，尚未完成唯一匹配，请联系管理员核对" };
  if (matched.size !== 1) return { ok: false, status: 409, error: matched.size ? "存在多份相似审核单，请联系管理员核对" : "平台暂未查到对应审核单，请稍后核对，勿重复交单" };
  const row = [...matched.values()][0];
  if (submission.externalOrderId && String(submission.externalOrderId) !== String(row.id)) return { ok: false, status: 409, error: "审核单关联已变更，请重新核对" };
  if (!submission.externalOrderId && (matchingSubmissions(state, row, userId).length !== 1 || state.submissions.some(item => item !== submission && String(item.externalOrderId) === String(row.id) && String(item.userId) === String(userId)))) return { ok: false, status: 409, error: "审核单无法唯一关联本地交单，请联系管理员核对" };
  if (![0, 1, 2, "0", "1", "2"].includes(row.status)) return { ok: false, status: 502, error: "平台审核状态未知，暂不修改积分" };
  submission.externalOrderId = String(row.id);
  submission.submissionState = "submitted";
  if (Number(row.status) !== 0) {
    const result = handleTaskCallback(state, { submissionId: submission.id, sf_uid: userId, status: row.status, remarks: row.remarks || row.reasons || "" });
    await saveState();
    if (!result.ok) return result;
  }
  resolveTaskAssociationExceptions(state, submission, "平台查询已确认交单关联并处理当前审核状态");
  await saveState();
  return { ok: true, submission: withTaskSummary(state, submission) };
}

async function reconcileCallback(state, payload) {
  // The documented register response is {}, so identify the platform order
  // using its authenticated examine list, never callback-supplied reward data.
  let row = null;
  for (let page = 1; page <= 20; page += 1) {
    const rows = await taskPlatform.post("index/index/get_examine_list", { page, status: "All", sf_uid: payload.sf_uid });
    if (!Array.isArray(rows)) break;
    row = rows.find(item => String(item.id) === String(payload.id) && String(item.sf_uid) === String(payload.sf_uid));
    if (row || !rows.length) break;
  }
  const candidates = row ? matchingSubmissions(state, row, payload.sf_uid) : [];
  if (candidates.length !== 1) {
    const type = "task_callback_mapping_ambiguous";
    if (!state.exceptions.some(item => item.type === type && item.bizNo === String(payload.id) && item.status !== "resolved")) createException(state, { type, bizNo: String(payload.id), action: "核对外部审核单和本地交单记录后重试通知", payload: { userId: String(payload.sf_uid), externalOrderId: String(payload.id), candidateIds: candidates.map(item => item.id) } });
    return { ok: false, status: 409, error: "审核单尚未唯一匹配，已记录待核对" };
  }
  const callbackStatus = String(payload.status);
  const equivalent = { approved: "1", pass: "1", rejected: "2", fail: "2" };
  if (String(row.status) !== (equivalent[callbackStatus] || callbackStatus)) return { ok: false, status: 409, error: "回调状态与平台审核状态不一致" };
  candidates[0].externalOrderId = String(row.id);
  candidates[0].submissionState = "submitted";
  await saveState();
  return { ok: true };
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
  const legacyFields = { "手机号": "mobile", "截图凭证": "images", "完成截图": "images", "账号": "text1", account: "text1" };
  const fields = task.submitFields || task.option || [];
  const submitFields = Array.isArray(fields) ? fields.map(field => Object.hasOwn(legacyFields, field) ? legacyFields[field] : field) : fields;
  return {
    ...task,
    rewardValid: Number.isSafeInteger(task.rewardPoints) && task.rewardPoints >= 0,
    submitFields,
    option: submitFields,
    paused: task.status === "paused"
  };
}

function normalizeSubmitPayload(payload = {}) {
  return {
    name: payload.name || "",
    mobile: payload.mobile || payload.phone || payload["手机号"] || "",
    text1: payload.text1 || payload.remark || payload.account || payload["账号"] || "",
    text2: payload.text2 || "",
    images: payload.images || payload.imgea || payload.screenshot || payload["截图凭证"] || payload["完成截图"] || "",
    raw: payload
  };
}

function withTaskSummary(state, submission) {
  const task = submission.taskSnapshot || taskRepository.findById(state, submission.taskId) || {};
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
  syncSubmission,
  getPlatformStatus,
  processTaskCallback
};
