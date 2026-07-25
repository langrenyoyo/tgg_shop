function listAll(state) {
  return state.refundOrders;
}

function findById(state, refundId) {
  return state.refundOrders.find((item) => item.id === refundId);
}

function findByOrderId(state, orderId) {
  return state.refundOrders.find((item) => item.orderId === orderId && !["rejected", "refunded", "failed"].includes(item.status));
}

function add(state, refundOrder) {
  state.refundOrders.unshift(refundOrder);
}

module.exports = {
  listAll,
  findById,
  findByOrderId,
  add
};
