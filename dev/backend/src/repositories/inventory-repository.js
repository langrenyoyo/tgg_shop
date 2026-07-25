const { nextId } = require("../data/store");

function listWithProduct(state) {
  return (state.inventoryLedger || []).map((entry) => ({
    ...entry,
    productName: state.products.find((product) => product.id === entry.productId)?.name || entry.productId
  }));
}

function addEntry(state, input = {}) {
  state.inventoryLedger ||= [];
  const product = input.product || state.products.find((item) => item.id === input.productId);
  const entry = {
    id: nextId("inv"),
    productId: product?.id || input.productId,
    changeType: input.changeType || "adjust",
    quantityDelta: Number(input.quantityDelta || 0),
    stockBefore: Number(input.stockBefore || 0),
    stockAfter: Number(input.stockAfter || 0),
    batchNo: String(input.batchNo || "").trim(),
    reason: cleanReason(input.reason),
    operatorRoleId: input.actor?.role?.id || input.actor?.id || input.operatorRoleId || "system",
    createdAt: input.createdAt || new Date().toISOString()
  };
  state.inventoryLedger.unshift(entry);
  return entry;
}

function inferAdminChangeType(before, after, preferred) {
  if (["purchase_in", "stocktake", "loss", "adjust"].includes(preferred)) return preferred;
  if (after === 0 && before > 0) return "loss";
  if (after > before) return "purchase_in";
  return "stocktake";
}

function cleanReason(reason) {
  return typeof reason === "string" ? reason.trim() : "";
}

module.exports = {
  listWithProduct,
  addEntry,
  inferAdminChangeType
};
