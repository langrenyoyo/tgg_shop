function listByUser(state, userId) {
  return state.orders.filter((order) => order.userId === userId);
}

function listAll(state) {
  return state.orders;
}

function findById(state, orderId) {
  return state.orders.find((item) => item.id === orderId);
}

function add(state, order) {
  state.orders.unshift(order);
}

module.exports = {
  listByUser,
  listAll,
  findById,
  add
};
