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
  const existingLedger = state.pointLedger.find((item) => item.idempotencyKey === idempotencyKey);
  if (submission.status === status || existingLedger) {
    return { ok: true, submission, idempotent: true };
  }

  submission.status = status;
  submission.remarks = remarks;
  submission.updatedAt = new Date().toISOString();

  if (status === "approved") {
    const task = taskRepository.findById(state, submission.taskId);
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

    user.points += task.rewardPoints;
    ledgerRepository.addPointEntry(state, {
      id: nextId("pt"),
      userId: user.id,
      changeType: "task_reward",
      direction: "in",
      points: task.rewardPoints,
      balanceAfter: user.points,
      bizNo: submission.id,
      idempotencyKey,
      createdAt: new Date().toISOString()
    });
    grantInviteCommission(state, user, task, submission);
  }

  saveState();
  return { ok: true, submission };
}

function normalizeStatus(status) {
  if (status === 1 || status === "1" || status === "approved" || status === "pass") return "approved";
  if (status === 2 || status === "2" || status === "rejected" || status === "fail") return "rejected";
  return "unknown";
}

function grantInviteCommission(state, invitee, task, submission) {
  const relation = inviteRepository.findByInvitee(state, invitee.id);
  if (!relation) return;

  const inviter = userRepository.findById(state, relation.inviterUserId);
  if (!inviter) {
    createException(state, {
      type: "invite_commission_inviter_missing",
      bizNo: submission.id,
      action: "人工核对邀请提成归属",
      payload: { inviteeUserId: invitee.id, inviterUserId: relation.inviterUserId }
    });
    return;
  }

  const commission = Math.floor(task.rewardPoints * Number(state.config.inviteCommissionRate || 0));
  if (commission <= 0) return;

  const idempotencyKey = `task_callback:${submission.id}:invite_commission`;
  if (state.pointLedger.some((item) => item.idempotencyKey === idempotencyKey)) return;

  inviter.points += commission;
  ledgerRepository.addPointEntry(state, {
    id: nextId("pt"),
    userId: inviter.id,
    changeType: "invite_commission",
    direction: "in",
    points: commission,
    balanceAfter: inviter.points,
    bizNo: submission.id,
    idempotencyKey,
    createdAt: new Date().toISOString()
  });
}

module.exports = {
  handleTaskCallback
};
