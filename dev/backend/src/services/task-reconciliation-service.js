const { nextId, saveState } = require("../data/store");
const platform = require("./task-platform-client");
const { handleTaskCallback } = require("../domain/task-callback-rules");
const { resolveTaskAssociationExceptions } = require("./task-exception-service");

async function reconcile(state, submissionId, input, actor) {
  input ||= {};
  const submission = state.submissions.find(item => item.id === submissionId);
  if (!submission) return { ok: false, status: 404, error: "本地提交单不存在" };
  if (submission.platform !== "bounty_platform") return { ok: false, status: 400, error: "仅平台交单使用平台关联核对" };
  const externalId = typeof input.externalOrderId === "string" ? input.externalOrderId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!externalId || !reason) return { ok: false, status: 400, error: "请填写平台审核单号和人工核对依据" };
  if (!platform.isConfigured()) return { ok: false, status: 503, error: "任务平台未配置" };
  let row;
  for (let page = 1; page <= 20; page++) {
    const rows = await platform.post("index/index/get_examine_list", { page, status: "All", sf_uid: submission.userId });
    if (!Array.isArray(rows)) return { ok: false, status: 502, error: "平台审核列表格式异常" };
    row = rows.find(item => String(item.id) === externalId);
    if (row || !rows.length) break;
  }
  if (!row) return { ok: false, status: 409, error: "前 20 页未查到指定审核单，请核对单号或查询范围" };
  if (String(row.sf_uid) !== String(submission.userId) || String(row.task_id) !== String(submission.taskId)) return { ok: false, status: 409, error: "平台审核单的用户或任务与本地交单不一致" };
  if (![0, 1, 2, "0", "1", "2"].includes(row.status)) return { ok: false, status: 502, error: "平台审核状态未知" };
  // Recheck after remote awaits, so concurrent administrators cannot share a mapping.
  if ((submission.externalOrderId && String(submission.externalOrderId) !== externalId) || state.submissions.some(item => item !== submission && String(item.externalOrderId) === externalId && item.platform === "bounty_platform")) return { ok: false, status: 409, error: "审核单已有关联，禁止覆盖或重复绑定" };
  const key = `task_reconcile:${submission.id}:${externalId}`;
  state.adminOperationLogs ||= [];
  if (!state.adminOperationLogs.some(item => item.idempotencyKey === key)) {
    state.adminOperationLogs.unshift({ id: nextId("op"), adminId: actor.adminId || null, roleId: actor.role?.id || actor.id, action: "task.reconcile", targetType: "task_submission", targetId: submission.id, reason, idempotencyKey: key, before: { externalOrderId: submission.externalOrderId }, after: { externalOrderId: externalId, platformStatus: row.status }, createdAt: new Date().toISOString() });
  }
  submission.externalOrderId = externalId;
  submission.submissionState = "submitted";
  await saveState();
  if (Number(row.status) !== 0) {
    const result = handleTaskCallback(state, { submissionId: submission.id, sf_uid: submission.userId, status: row.status, remarks: row.remarks || row.reasons || "" });
    if (!result.ok) { await saveState(); return result; }
  }
  resolveTaskAssociationExceptions(state, submission, `平台关联核对完成：${reason}`, actor.role?.id || actor.id);
  await saveState();
  return { ok: true, submission };
}

module.exports = { reconcile };
