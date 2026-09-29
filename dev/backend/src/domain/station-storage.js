const crypto = require("node:crypto");
const labels = { ambient: "常温", chilled: "冷藏", frozen: "冷冻", fresh: "生鲜" };

function packagesFor(record = {}) {
  const rows = Array.isArray(record.packages) && record.packages.length ? record.packages : record.shelfCode ? [{ shelfCode: record.shelfCode, storageType: "ambient", bagCount: 1, legacy: true }] : [];
  return rows.map((row, index) => ({ ...row, id: `package-${index + 1}`, storageLabel: row.legacy ? "原存放位" : labels[row.storageType] || "常温" }));
}

function preparePackages(state, order, input, record) {
  const source = input.packages === undefined ? record.packages?.length ? record.packages : [{ shelfCode: input.shelfCode || record.shelfCode || "", storageType: "ambient", bagCount: 1 }] : input.packages;
  if (!Array.isArray(source) || !source.length || source.length > 12) return { ok: false, status: 400, error: "请填写 1 至 12 个存放位置" };
  const occupied = new Set((state.stationOrders || []).filter(row => row.siteId === (order.pickupSiteId || order.siteId) && row.orderId !== order.id && !["picked_up", "returned"].includes(row.stationStatus)).flatMap(packagesFor).map(row => row.shelfCode));
  const used = new Set();
  const packages = [];
  for (const row of source) {
    if (!row || typeof row.shelfCode !== "string" || row.shelfCode.trim().length > 40 || !Object.hasOwn(labels, row.storageType) || !Number.isInteger(row.bagCount) || row.bagCount < 1 || row.bagCount > 99) return { ok: false, status: 400, error: "存放位置需为 40 字以内，选择存放类型并填写 1 至 99 袋" };
    let shelfCode = row.shelfCode.trim();
    if (!shelfCode && row.storageType !== "ambient") return { ok: false, status: 400, error: "冷藏、冷冻和生鲜商品请填写实际存放位置" };
    if (!shelfCode) { let n = 1; do { shelfCode = `${state.config?.stationShelfPrefix || "S-"}${String(n++).padStart(4, "0")}`; } while (occupied.has(shelfCode) || used.has(shelfCode)); }
    if (occupied.has(shelfCode) || used.has(shelfCode)) return { ok: false, status: 409, error: "提货位已被占用或重复，请更换" };
    used.add(shelfCode);
    packages.push({ shelfCode, storageType: row.storageType, bagCount: row.bagCount });
  }
  return { ok: true, packages };
}

function pickupVersion(order, record) {
  return crypto.createHash("sha256").update(JSON.stringify({ id: order.id, siteId: order.pickupSiteId || order.siteId, receivedAt: record.receivedAt, items: order.items, packages: packagesFor(record) })).digest("hex");
}

module.exports = { packagesFor, preparePackages, pickupVersion };
