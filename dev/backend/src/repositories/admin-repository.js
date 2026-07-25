function listRoles(state) {
  return state.roles;
}

function listExceptions(state) {
  return state.exceptions;
}

function countSummary(state) {
  return {
    orderCount: state.orders.length,
    paidOrderCount: state.orders.filter((item) => item.status === "paid").length,
    userCount: state.users.length,
    pointLedgerCount: state.pointLedger.length,
    exceptionCount: state.exceptions.length,
    productCount: state.products.length
  };
}

module.exports = {
  listRoles,
  listExceptions,
  countSummary
};
