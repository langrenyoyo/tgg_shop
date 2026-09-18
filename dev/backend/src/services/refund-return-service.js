const { saveState, nextId } = require("../data/store");
const inventory = require("../repositories/inventory-repository");
const tickets = require("../repositories/ticket-repository");

function listReturns(state) {
  return (state.operationTickets || []).filter(ticket => ticket.linkedType === "refund_return").map(ticket => {
    const refund = state.refundOrders.find(item => item.id === ticket.linkedId);
    const order = state.orders.find(item => item.id === refund?.orderId);
    return { ...ticket, refundId: ticket.linkedId, orderId: order?.id, items: order?.items || [] };
  });
}

async function resolveReturn(state, refundId, input, actor) {
  const ticket = tickets.findLinked(state, "refund_return", refundId);
  const refund = state.refundOrders.find(item => item.id === refundId);
  const order = state.orders.find(item => item.id === refund?.orderId);
  if (!ticket || !refund || !order) return { ok: false, status: 404, error: "退货核对记录不存在" };
  if (refund.status !== "refunded") return { ok: false, status: 409, error: "退款账务尚未完成" };
  const disposition = input.disposition;
  if (!["restock", "no_restock", "partial"].includes(disposition) || typeof input.reason !== "string" || !input.reason.trim()) return { ok: false, status: 400, error: "请选择回库方式并填写验收或不回库原因" };
  if (!order.items.length || order.items.some(item => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) return { ok: false, status: 409, error: "订单商品数量异常，请先核对" };
  const inspected = disposition === "partial" ? input.items : order.items.map(item => ({ productId: item.productId, restockQuantity: disposition === "restock" ? item.quantity : 0 }));
  if (!Array.isArray(inspected) || inspected.length !== order.items.length || new Set(inspected.map(item => item?.productId)).size !== inspected.length || inspected.some(item => {
    const ordered = order.items.find(row => row.productId === item?.productId);
    return !ordered || !Number.isSafeInteger(item.restockQuantity) || item.restockQuantity < 0 || item.restockQuantity > ordered.quantity;
  })) return { ok: false, status: 400, error: "请逐项填写合法回库数量，不能遗漏、重复或超出原订单数量" };
  const items = inspected.map(item => ({ productId: item.productId, restockQuantity: item.restockQuantity, noRestockQuantity: order.items.find(row => row.productId === item.productId).quantity - item.restockQuantity })).sort((a, b) => a.productId.localeCompare(b.productId));
  const key = `refund_return:${refundId}`;
  const existing = (state.adminOperationLogs || []).find(item => item.idempotencyKey === key);
  if (existing) {
    if (existing.after?.disposition !== disposition || (existing.after?.items && JSON.stringify(existing.after.items) !== JSON.stringify(items))) return { ok: false, status: 409, error: "退货已按其他方式或数量处理，请勿重复变更库存" };
    await saveState();
    return { ok: true, ticket, idempotent: true };
  }
  if (["resolved", "closed"].includes(ticket.status)) return { ok: false, status: 409, error: "该工单已处理但缺少验收凭据，请人工核对原库存流水" };
  const returned = items.filter(item => item.restockQuantity > 0);
  if (returned.length) {
    if (returned.some(item => {
      const product = state.products.find(product => product.id === item.productId);
      return !product || !Number.isSafeInteger(product.stock + item.restockQuantity);
    })) return { ok: false, status: 409, error: "商品或库存数据异常，请先核对" };
    for (const item of returned) {
      const product = state.products.find(product => product.id === item.productId);
      const stockBefore = product.stock;
      product.stock += item.restockQuantity;
      inventory.addEntry(state, { product, changeType: "refund_restore", quantityDelta: item.restockQuantity, stockBefore, stockAfter: product.stock, reason: `退款验收回库 ${refundId}：${input.reason.trim()}`, actor });
    }
  }
  const reply = `${disposition === "restock" ? "整单商品已验收回库" : disposition === "partial" ? "分项验收完成" : "确认不增加可售库存"}：${input.reason.trim()}；${items.map(item => `${item.productId} 回库 ${item.restockQuantity}，不回库 ${item.noRestockQuantity}`).join("；")}`;
  tickets.resolveLinked(state, "refund_return", refundId, reply, actor.role?.id || actor.id);
  state.adminOperationLogs ||= [];
  state.adminOperationLogs.unshift({ id: nextId("op"), adminId: actor.adminId || null, roleId: actor.role?.id || actor.id, action: "refund.return.resolve", targetType: "refund", targetId: refundId, reason: input.reason.trim(), idempotencyKey: key, before: {}, after: { disposition, orderId: order.id, items }, createdAt: new Date().toISOString() });
  await saveState();
  return { ok: true, ticket };
}

module.exports = { listReturns, resolveReturn };
