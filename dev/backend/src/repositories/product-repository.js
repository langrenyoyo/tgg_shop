function listActive(state, category) {
  return state.products.filter((item) => item.status === "on" && (!category || item.category === category));
}

function listRecommended(state) {
  return state.products.filter((product) => !product.purePointsOnly).slice(0, 4);
}

function listPurePoints(state) {
  return state.products.filter((item) => item.purePointsOnly && item.status === "on");
}

function findById(state, productId) {
  return state.products.find((product) => product.id === productId);
}

function findActiveById(state, productId) {
  const product = findById(state, productId);
  return product && product.status === "on" ? product : null;
}

function decrementStock(product, quantity) {
  product.stock -= quantity;
}

function incrementStock(product, quantity) {
  product.stock += quantity;
}

module.exports = {
  listActive,
  listRecommended,
  listPurePoints,
  findById,
  findActiveById,
  decrementStock,
  incrementStock
};
