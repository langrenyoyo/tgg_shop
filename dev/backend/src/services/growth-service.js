function getInviteInfo(state, user) {
  const invitedCount = (state.inviteRelations || []).filter(relation => relation.inviterUserId === user.id).length;
  const totalCommission = state.pointLedger
    .filter((entry) => entry.userId === user.id && entry.changeType === "invite_commission")
    .reduce((sum, entry) => sum + entry.points, 0);
  return {
    inviteCode: user.inviteCode,
    shareUrl: `https://tgg.example/register?invite=${user.inviteCode}`,
    rewardInvite: state.config.inviteRewardPoints,
    rewardRatio: Number(state.config.inviteCommissionRate || 0) * 100,
    totalInvited: invitedCount,
    totalCommission
  };
}

function listInviteUsers(state, user, query = {}) {
  const owners = new Map(state.submissions.map(item => [item.id, item.userId]));
  const contributions = new Map();
  for (const entry of state.pointLedger) {
    if (entry.userId !== user.id || entry.changeType !== "invite_commission") continue;
    const owner = owners.get(entry.bizNo);
    if (owner) contributions.set(owner, (contributions.get(owner) || 0) + entry.points);
  }
  let relations = (state.inviteRelations || []).filter(relation => relation.inviterUserId === user.id);
  const total = relations.length;
  const paged = query.page !== undefined || query.count !== undefined;
  const page = Number(query.page || 1), count = Number(query.count || 20);
  if (paged) relations = relations.slice().sort((a, b) => String(b.boundAt).localeCompare(String(a.boundAt)) || String(b.inviteeUserId).localeCompare(String(a.inviteeUserId))).slice((page - 1) * count, page * count);
  const users = new Map(state.users.map(item => [item.id, item]));
  const rows = relations
    .map((relation) => {
      const invitee = users.get(relation.inviteeUserId);
      const contributed = contributions.get(relation.inviteeUserId) || 0;
      return {
        uid: relation.inviteeUserId,
        nickname: invitee?.nickname || relation.inviteeUserId,
        registeredAt: relation.boundAt,
        contributed
      };
    });
  return paged ? { rows, total, page, count } : rows;
}

function getInviteStats(state, user) {
  const list = listInviteUsers(state, user);
  return {
    totalInvited: list.length,
    totalCommission: list.reduce((sum, item) => sum + item.contributed, 0),
    inviteRewardPoints: state.config.inviteRewardPoints,
    commissionRate: Number(state.config.inviteCommissionRate || 0) * 100
  };
}

module.exports = { getInviteInfo, listInviteUsers, getInviteStats };
