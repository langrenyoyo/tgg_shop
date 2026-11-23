// Display data only: never use these values to settle or reprice an order.
function productSnapshot(product) {
  if (!product) return null;
  const result = {};
  for (const key of ["name", "image", "unit", "regularPrice", "cashPrice", "cashPriceText", "pointsPrice", "pointsPriceText", "supportsCash", "supportsPoints", "purePointsOnly", "membershipGiftDays"]) {
    if (product[key] !== undefined) result[key] = product[key];
  }
  return result;
}

function itemView(state, item) {
  const snapshot = item.productSnapshot;
  const product = productSnapshot(snapshot || state.products.find(row => row.id === item.productId));
  return { ...item, product: product ? { ...product, name: item.title || product.name } : { name: item.title || item.productId }, priceIsCurrent: !snapshot };
}

function orderCounts(state, userId) {
  const counts = { pendingPayment: 0, pendingPickup: 0, shipping: 0, refunding: 0 };
  if (!userId) return counts;
  for (const order of state.orders) {
    if (order.userId !== userId) continue;
    if (order.status === "pending_payment") counts.pendingPayment++;
    if (order.status === "paid" && order.fulfillmentStatus === "pending_pickup") counts.pendingPickup++;
    if (order.status === "paid" && order.fulfillmentStatus === "shipping") counts.shipping++;
    if (order.status === "refunding") counts.refunding++;
  }
  return counts;
}

module.exports = { productSnapshot, itemView, orderCounts };
