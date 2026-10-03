const { randomUUID } = require("node:crypto");

function data(state) { return state.printing ||= { printers: [], jobs: [] }; }
function fail(status, error) { return { ok: false, status, error }; }
function printable(order) { return order && ["paid", "completed"].includes(order.status); }
function matches(printer, order) {
  return printer.fulfillmentType === order.fulfillmentType && (order.fulfillmentType !== "pickup" || printer.siteId === order.pickupSiteId);
}
function clean(value, max = 200) {
  return Array.from(String(value ?? "")).map(c => /[\u0020-\u007e\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/u.test(c) ? c : " ").join("")
    .replace(/</g, "＜").replace(/>/g, "＞").slice(0, max);
}
function receiptText(value, columns) {
  let width = 0;
  return Array.from(clean(value, 500)).map(c => {
    const size = c.charCodeAt(0) > 127 ? 2 : 1;
    const prefix = width + size > columns ? "<BR>" : "";
    width = prefix ? size : width + size;
    return prefix + c;
  }).join("");
}
function buildReceipt(state, order, printer, { reprint = false } = {}) {
  const columns = printer.paperWidth === 58 ? 32 : 48;
  const separator = "-".repeat(columns) + "<BR>";
  const payments = (state.paymentLedger || []).filter(p => p.orderId === order.id && p.status === "paid" && p.direction === "in");
  // Positive cash without verified provider evidence is never labelled as a real receipt.
  const test = Number(order.cashAmount) > 0 && (!payments.length || payments.some(p => !p.thirdTradeNo || /^(TEST|MOCK)_/.test(p.thirdTradeNo) || p.channel?.startsWith("mock")));
  const lines = [`<CB>${clean(printer.shopName || "TGG Shop", 40)}<BR></CB>`, ...(test ? ["<CB>测试订单，未实际收款<BR></CB>"] : []), ...(reprint ? ["<B>补打联<BR></B>"] : []),
    `订单：${clean(order.id, 100)}<BR>`, `${order.fulfillmentType === "pickup" ? "自提" : "配送"} · ${order.paymentMode === "pure_points" ? "积分兑换" : "商品订单"}<BR>`,
    `下单：${clean(order.createdAt, 30)}<BR>`, separator];
  for (const item of order.items || []) {
    const product = (state.products || []).find(p => p.id === item.productId);
    lines.push(`${receiptText(`${item.title || item.name || product?.name || item.productId} 数量：${item.quantity}`, columns)}<BR>`);
    if (product?.locationCode) lines.push(`库位：${clean(product.locationCode, 40)}<BR>`);
  }
  lines.push(separator, `现金：${Number(order.cashAmount || 0).toFixed(2)}元  积分：${Number(order.pointAmount || 0)}<BR>`);
  if (order.fulfillmentType === "pickup") {
    const site = (state.pickupSites || []).find(s => s.id === order.pickupSiteId);
    lines.push(`站点：${clean(site?.name || order.pickupSiteId, 60)}<BR>`);
    // The internal order number locates goods; the user's pickup verification secret is not printed.
    const station = (state.stationOrders || []).find(s => s.orderId === order.id);
    const packages = require("../domain/station-storage").packagesFor(station || {});
    for (const pack of packages) if (pack.shelfCode) lines.push(`储位：${clean(pack.shelfCode, 40)} · ${pack.bagCount}袋<BR>`);
  } else lines.push(`${receiptText(`收货信息：${order.deliveryAddress || ""}`, columns)}<BR>`, `配送：${clean(order.deliveryDate, 30)} ${clean(order.deliveryTimeSlot, 40)}<BR>`);
  lines.push(`<QRCODE s=6 e=L l=center>${clean(order.id, 100)}</QRCODE><BR>`, `${clean(printer.footer || "请核对商品与数量", 120)}<BR><BR>`);
  const content = lines.join("");
  // Conservative upper bound for GBK; unsupported characters have already been replaced.
  if (Array.from(content).reduce((n,c)=>n+(c.charCodeAt(0)>127?2:1),0) > 12000) throw new Error("订单商品过多，超过小票长度限制，请拆分处理");
  return { content, test };
}
function queue(state, order, printer, { key, actor = "system", reason = "订单支付成功", reprint = false, now = new Date().toISOString() } = {}) {
  const store = data(state);
  const old = store.jobs.find(j => j.key === key);
  if (old) return old.orderId === order.id && old.printerId === printer.id && old.reprint === reprint ? { ok: true, job: old, idempotent: true } : fail(409, "请求标识已用于其他打印任务");
  if (!printable(order)) return fail(409, "仅已支付或已完成的商品订单可以打印");
  if (!printer.enabled || !matches(printer, order)) return fail(409, "打印机未启用或与订单站点、履约方式不匹配");
  let snapshot;
  try { snapshot = buildReceipt(state, order, printer, { reprint }); } catch(error) { return fail(400, error.message); }
  const job = { id: `prj_${randomUUID()}`, key, printerId: printer.id, sn: printer.sn, orderId: order.id, ...snapshot,
    copies: printer.copies, expiresIn: 3600, status: "queued", attempts: 0, actor, reason, reprint, createdAt: now, updatedAt: now };
  store.jobs.unshift(job);
  return { ok: true, job };
}
function enqueueAuto(state, order) {
  // Synchronous outbox creation is persisted together with the order/payment state.
  for (const printer of data(state).printers) {
    if (!printer.enabled || !printer.autoPrint || !matches(printer, order)) continue;
    const result = queue(state, order, printer, { key: `auto:${order.id}:${printer.id}` });
    if (!result.ok && printable(order)) {
      const key = `auto:${order.id}:${printer.id}`;
      if (!data(state).jobs.some(j => j.key === key)) data(state).jobs.unshift({ id:`prj_${randomUUID()}`,key,printerId:printer.id,sn:printer.sn,orderId:order.id,status:"failed",error:result.error,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() });
    }
  }
}
module.exports = { data, fail, printable, matches, clean, buildReceipt, queue, enqueueAuto };
