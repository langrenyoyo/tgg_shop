function findById(state, userId) {
  return state.users.find((user) => user.id === userId);
}

function findCurrent(state, userId = state.currentUserId) {
  return findById(state, userId) || findById(state, state.currentUserId);
}

function setCurrentUser(state, userId) {
  state.currentUserId = userId;
}

module.exports = {
  findById,
  findCurrent,
  setCurrentUser
};
