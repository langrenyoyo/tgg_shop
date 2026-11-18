function listVisible(state) {
  return state.products.filter(item => !item.deletedAt).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function listActive(state, category) {
  return listVisible(state).filter((item) => item.status === "on" && (!category || item.category === category));
}

function listRecommended(state) {
  return listActive(state).filter((product) => !product.purePointsOnly).slice(0, 20);
}

function listPurePoints(state) {
  return listActive(state).filter((item) => item.purePointsOnly);
}

function findById(state, productId) {
  return state.products.find((product) => product.id === productId);
}

function findActiveById(state, productId) {
  const product = findById(state, productId);
  return product && !product.deletedAt && product.status === "on" ? product : null;
}

function decrementStock(product, quantity) {
  product.stock -= quantity;
}

function incrementStock(product, quantity) {
  product.stock += quantity;
}

module.exports = {
  listVisible,
  listActive,
  listRecommended,
  listPurePoints,
  findById,
  findActiveById,
  decrementStock,
  incrementStock
};
