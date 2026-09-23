const { nextId, saveState } = require("../data/store");
const { createException } = require("./exception-rules");
const userRepository = require("../repositories/user-repository");
const taskRepository = require("../repositories/task-repository");
const ledgerRepository = require("../repositories/ledger-repository");
const inviteRepository = require("../repositories/invite-repository");

function handleTaskCallback(state, payload) {
  const submissionId = payload.submissionId || payload.id;
  const status = normalizeStatus(payload.status);
  const remarks = payload.remarks || "";
  if (!submissionId) return { ok: false, status: 400, error: "缺少提交单 ID" };
  if (!["approved", "rejected"].includes(status)) return { ok: false, status: 400, error: "未知回调状态" };

  const submission = taskRepository.findSubmission(state, submissionId, payload.sf_uid);
  if (!submission) {
    createException(state, {
      type: "task_callback_submission_missing",
      bizNo: submissionId,
      action: "人工核对悬赏平台回调提交单",
      payload
    });
    return { ok: false, status: 404, error: "提交单不存在" };
  }

  const idempotencyKey = `task_callback:${submission.id}:${status}`;
  const existingLedger = state.pointLedger.find((item) => item.idempotencyKey === `task_callback:${submission.id}:approved`);
  const commissionKey = `task_callback:${submission.id}:invite_commission`;
  const existingCommission = state.pointLedger.find(item => item.idempotencyKey === commissionKey);
  if ([`task_callback:${submission.id}:approved`, commissionKey].some(key => state.pointLedger.filter(item => item.idempotencyKey === key).length > 1)) return { ok: false, status: 409, error: "任务奖励存在重复流水，请人工核对" };
  if ((submission.status === "approved" || existingLedger || existingCommission) && status === "rejected") {
    return { ok: false, status: 409, error: "任务已发奖，撤销须通过积分追回流程处理" };
  }
  if (status === "rejected" && submission.status === status) {
    saveState();
    return { ok: true, submission, idempotent: true };
  }

  let posted = false;
  if (status === "approved") {
    const task = submission.taskSnapshot || taskRepository.findById(state, submission.taskId);
    const user = userRepository.findById(state, submission.userId);
    if (!task || !user) {
      createException(state, {
        type: "task_callback_data_missing",
        bizNo: submission.id,
        action: "人工核对任务、用户与积分入账",
        payload
      });
      saveState();
      return { ok: false, status: 400, error: "任务或用户数据缺失" };
    }

    // Missing or malformed snapshots must not turn into an approved zero-point reward.
    // Retain numeric-string support for historical persisted task records.
    const rawReward = Object.prototype.hasOwnProperty.call(task, "rewardPoints") ? task.rewardPoints : task.usersRatio;
    const numericReward = typeof rawReward === "number" || typeof rawReward === "string" && /^\d+(?:\.0+)?$/.test(rawReward.trim());
    const rewardPoints = numericReward ? Number(rawReward) : NaN;
    if (task.rewardValid === false || !Number.isSafeInteger(rewardPoints) || rewardPoints < 0) return { ok: false, status: 409, error: "任务奖励快照无效" };
    const relation = inviteRepository.findByInvitee(state, user.id);
    const commissionRate = Number(task.inviteCommissionRate ?? state.config.inviteCommissionRate ?? 0);
    const hasPlatformCommission = Object.prototype.hasOwnProperty.call(task, "inviteCommissionPoints") && task.inviteCommissionPoints !== null && task.inviteCommissionPoints !== undefined;
    const platformCommission = hasPlatformCommission ? Number(task.inviteCommissionPoints) : null;
    if (hasPlatformCommission && (!Number.isSafeInteger(platformCommission) || platformCommission < 0)) return { ok: false, status: 409, error: "任务邀请提成快照无效" };
    if (!hasPlatformCommission && (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1)) return { ok: false, status: 409, error: "邀请提成比例无效" };
    const inviter = relation && userRepository.findById(state, relation.inviterUserId);
    if (relation && !inviter) return { ok: false, status: 409, error: "邀请人数据缺失，请补全后重试" };
    const commission = relation ? (hasPlatformCommission ? platformCommission : Math.floor(rewardPoints * commissionRate)) : 0;
    const validLedger = (entry, owner, points, type) => !entry || (entry.userId === owner?.id && entry.points === points && entry.bizNo === submission.id && entry.direction === "in" && entry.changeType === type);
    if (!validLedger(existingLedger, user, rewardPoints, "task_reward") || !validLedger(existingCommission, inviter, commission, "invite_commission")) return { ok: false, status: 409, error: "任务奖励流水与应发数据不一致，请人工核对" };
    const entries = [];
    if (!existingLedger) entries.push({ owner: user, points: rewardPoints, changeType: "task_reward", key: idempotencyKey });
    if (commission > 0 && !existingCommission) entries.push({ owner: inviter, points: commission, changeType: "invite_commission", key: commissionKey });
    const balances = new Map();
    for (const entry of entries) {
      const before = balances.has(entry.owner.id) ? balances.get(entry.owner.id) : entry.owner.points;
      if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(before + entry.points)) return { ok: false, status: 409, error: "用户积分余额异常，请核对后重试" };
      balances.set(entry.owner.id, before + entry.points);
    }
    // Validate every recipient before any balance or ledger mutation.
    for (const entry of entries) {
      entry.owner.points += entry.points;
      posted = true;
      ledgerRepository.addPointEntry(state, {
        id: nextId("pt"), userId: entry.owner.id, changeType: entry.changeType,
        direction: "in", points: entry.points, balanceAfter: entry.owner.points,
        bizNo: submission.id, idempotencyKey: entry.key, createdAt: new Date().toISOString()
      });
    }
  }

  submission.status = status;
  submission.remarks = remarks;
  submission.updatedAt = new Date().toISOString();

  saveState();
  return { ok: true, submission, idempotent: Boolean(existingLedger) && !posted };
}

function normalizeStatus(status) {
  if (status === 1 || status === "1" || status === "approved" || status === "pass") return "approved";
  if (status === 2 || status === "2" || status === "rejected" || status === "fail") return "rejected";
  return "unknown";
}

module.exports = {
  handleTaskCallback
};
