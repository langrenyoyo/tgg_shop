function findByInvitee(state, inviteeUserId) {
  return (state.inviteRelations || []).find((item) => item.inviteeUserId === inviteeUserId);
}

function listByInviter(state, inviterUserId) {
  return (state.inviteRelations || []).filter((item) => item.inviterUserId === inviterUserId);
}

module.exports = {
  findByInvitee,
  listByInviter
};
