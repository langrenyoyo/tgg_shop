const { nextId, saveState } = require("../data/store");
const { verifyPickup } = require("../domain/fulfillment-rules");

const RECEIVABLE = new Set(["paid"]);
const BLOCKED = new Set(["cancelled", "refunding", "refunded", "closed"]);

function siteIds(account) { return Array.isArray(account?.siteIds) ? account.siteIds : []; }

function allowedSite(account, siteId) {
  return siteIds(account).includes(String(siteId || ""));
}

function publicStation(account) {
  return { id: account.id, username: account.username, name: account.name, role: account.role, siteIds: siteIds(account) };
}

function sitesFor(state, account) {
  return (state.pickupSites || []).filter((site) => siteIds(account).includes(site.id));
}

function stationOrder(state, order) {
  return (state.stationOrders || []).find((item) => item.orderId === order.id);
}

function orderSiteId(order) { return order?.pickupSiteId || order?.siteId || ""; }

function siteOrderAllowed(account, order) {
  return Boolean(order && order.fulfillmentType === "pickup" && allowedSite(account, orderSiteId(order)));
}

function safeOrder(order, station = {}) {
  if (!order) return null;
  return {
    id: order.id,
    userId: order.userId,
    userPhone: order.userPhone ? maskPhone(order.userPhone) : "",
    items: order.items || [],
    cashAmount: order.cashAmount || 0,
    pointAmount: order.pointAmount || 0,
    paymentMode: order.paymentMode,
    status: order.status,
    fulfillmentType: order.fulfillmentType,
    pickupSiteId: orderSiteId(order),
    pickupCode: station.includePickupCode ? order.pickupCode : undefined,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt,
    stationStatus: station.stationStatus || deriveStatus(order),
    shelfCode: station.shelfCode || "",
    receivedAt: station.receivedAt || "",
    pickedUpAt: station.pickedUpAt || "",
    exceptionType: station.exceptionType || "",
    exceptionRemark: station.exceptionRemark || ""
  };
}

function idempotentResult(state, key, account, orderId, action) {
  const existing = (state.stationOperationLogs || []).find((item) => item.idempotencyKey === key);
  if (!existing) return null;
  if (existing.operatorId !== account.id || existing.orderId !== orderId || existing.action !== action) {
    return { ok: false, status: 409, error: "幂等键已用于其他站点操作" };
  }
  return existing.response || (existing.result && typeof existing.result === "object" ? existing.result : null) || { ok: existing.result === "success", error: existing.reason };
}

function validateReceivedItems(order, receivedItems) {
  if (receivedItems === undefined) return { ok: true, items: order.items || [] };
  if (!Array.isArray(receivedItems) || receivedItems.length !== (order.items || []).length) return { ok: false, error: "实收商品明细与订单不一致" };
  const expected = new Map((order.items || []).map((item) => [String(item.productId), Number(item.quantity)]));
  for (const item of receivedItems) {
    const productId = String(item?.productId || "");
    const quantity = Number(item?.quantity);
    if (!expected.has(productId) || !Number.isInteger(quantity) || quantity < 0 || quantity !== expected.get(productId)) return { ok: false, error: "实收商品数量与订单不一致" };
  }
  return { ok: true, items: receivedItems };
}

function maskPhone(value) {
  const text = String(value || "");
  return text.length >= 7 ? `${text.slice(0, 3)}****${text.slice(-4)}` : text;
}

function deriveStatus(order) {
  if (order?.stationStatus) return order.stationStatus;
  if (order?.fulfillmentStatus === "picked_up") return "picked_up";
  if (order?.fulfillmentStatus === "pending_pickup") return "expected";
  return order?.fulfillmentStatus || "expected";
}

function listOrders(state, account, query = {}) {
  const keyword = String(query.keyword || "").trim().toLowerCase();
  const status = String(query.status || "");
  return (state.orders || []).filter((order) => siteOrderAllowed(account, order)).filter((order) => {
    const record = stationOrder(state, order);
    const stationStatus = record?.stationStatus || deriveStatus(order);
    if (status && status !== "all" && status !== stationStatus && status !== order.fulfillmentStatus) return false;
    if (!keyword) return true;
    return [order.id, order.userId, order.pickupSiteId, record?.shelfCode, ...(order.items || []).map((item) => item.title || item.name || item.productId)].some((value) => String(value || "").toLowerCase().includes(keyword));
  }).map((order) => safeOrder(order, stationOrder(state, order))).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function findAccessibleOrder(state, account, orderId) {
  const order = (state.orders || []).find((item) => item.id === orderId);
  return siteOrderAllowed(account, order) ? order : null;
}

function dashboard(state, account) {
  const orders = listOrders(state, account);
  const today = new Date().toISOString().slice(0, 10);
  return {
    station: sitesFor(state, account),
    counts: {
      pendingReceive: orders.filter((item) => ["expected", "in_transit"].includes(item.stationStatus) && !BLOCKED.has(item.status)).length,
      readyPickup: orders.filter((item) => ["received", "ready"].includes(item.stationStatus)).length,
      todayPickedUp: orders.filter((item) => item.stationStatus === "picked_up" && String(item.pickedUpAt || "").startsWith(today)).length,
      exceptions: orders.filter((item) => item.stationStatus === "exception" || item.exceptionType).length
    }
  };
}

function appendLog(state, input) {
  state.stationOperationLogs ||= [];
  const existing = input.idempotencyKey && state.stationOperationLogs.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (existing) return existing;
  const log = { id: nextId("station_op"), ...input, createdAt: new Date().toISOString() };
  state.stationOperationLogs.unshift(log);
  return log;
}

function receive(state, account, orderId, input = {}) {
  const order = findAccessibleOrder(state, account, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在或不属于当前站点" };
  const key = String(input.idempotencyKey || `receive:${account.id}:${orderId}`);
  const replay = idempotentResult(state, key, account, order.id, "receive");
  if (replay) return replay;
  if (!RECEIVABLE.has(order.status) || BLOCKED.has(order.status)) return failure(state, account, order, "receive", key, "订单未支付或当前状态不允许收货");
  if (order.fulfillmentStatus !== "pending_pickup") return failure(state, account, order, "receive", key, "订单不是待自提状态或已经收货");
  const requestedSite = input.siteId === undefined ? orderSiteId(order) : String(input.siteId);
  if (requestedSite !== orderSiteId(order) || !allowedSite(account, requestedSite)) return failure(state, account, order, "receive", key, "订单不属于当前作业站点");
  const condition = String(input.condition || "normal");
  const record = stationOrder(state, order) || { orderId: order.id, siteId: orderSiteId(order) };
  if (["received", "ready", "picked_up", "completed"].includes(record.stationStatus)) return failure(state, account, order, "receive", key, "订单已经完成收货，不能重复收货");
  const quantities = validateReceivedItems(order, input.receivedItems);
  if (!quantities.ok) return failure(state, account, order, "receive", key, quantities.error);
  Object.assign(record, { siteId: orderSiteId(order), stationStatus: condition === "normal" ? "ready" : "exception", shelfCode: String(input.shelfCode || ""), receivedItems: quantities.items, receivedAt: new Date().toISOString(), receivedBy: account.id, exceptionType: condition === "normal" ? "" : condition, exceptionRemark: String(input.remark || "") });
  order.stationStatus = record.stationStatus;
  state.stationOrders ||= [];
  if (!state.stationOrders.includes(record)) state.stationOrders.unshift(record);
  const result = { ok: true, order: safeOrder(order, record), logId: null };
  const log = appendLog(state, { siteId: record.siteId, orderId: order.id, operatorId: account.id, action: "receive", result: "success", reason: input.remark || "", idempotencyKey: key, response: result });
  result.logId = log.id;
  log.response = result;
  saveState();
  return result;
}

function pickup(state, account, orderId, input = {}) {
  const order = findAccessibleOrder(state, account, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在或不属于当前站点" };
  const key = String(input.idempotencyKey || `pickup:${account.id}:${orderId}`);
  const replay = idempotentResult(state, key, account, order.id, "pickup_verify");
  if (replay) return replay;
  if (input.siteId !== undefined && String(input.siteId) !== orderSiteId(order)) return failure(state, account, order, "pickup_verify", key, "订单不属于当前作业站点");
  const record = stationOrder(state, order);
  if (!record || !["received", "ready"].includes(record.stationStatus)) return failure(state, account, order, "pickup_verify", key, "订单尚未完成站点收货或当前不可提货");
  if (BLOCKED.has(order.status) || !RECEIVABLE.has(order.status)) return failure(state, account, order, "pickup_verify", key, "订单支付或状态不允许提货");
  if (!input.pickupCode || String(input.pickupCode) !== String(order.pickupCode)) return failure(state, account, order, "pickup_verify", key, "取货码不正确");
  const checked = verifyPickup(state, order.id, input.pickupCode, { operatorType: "station", operatorId: account.id });
  if (!checked.ok && !checked.idempotent) return failure(state, account, order, "pickup_verify", key, checked.error);
  record.stationStatus = "picked_up";
  record.pickedUpAt = new Date().toISOString();
  record.pickedUpBy = account.id;
  order.stationStatus = "picked_up";
  const result = { ok: true, order: safeOrder(order, record), logId: null };
  const log = appendLog(state, { siteId: record.siteId, orderId: order.id, operatorId: account.id, action: "pickup_verify", result: "success", reason: "", idempotencyKey: key, response: result });
  result.logId = log.id;
  log.response = result;
  saveState();
  return result;
}

function failure(state, account, order, action, key, error) {
  const record = stationOrder(state, order);
  const result = { ok: false, status: 400, error };
  appendLog(state, { siteId: orderSiteId(order), orderId: order.id, operatorId: account.id, action, result: "failed", reason: error, idempotencyKey: key, response: result });
  saveState();
  return result;
}

function createException(state, account, orderId, input = {}) {
  const order = findAccessibleOrder(state, account, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在或不属于当前站点" };
  const type = String(input.type || "unknown");
  const key = String(input.idempotencyKey || `exception:${account.id}:${orderId}:${type}`);
  const replay = idempotentResult(state, key, account, order.id, "exception");
  if (replay) return replay;
  const record = stationOrder(state, order) || { orderId: order.id, siteId: orderSiteId(order) };
  if (input.siteId !== undefined && String(input.siteId) !== orderSiteId(order)) return failure(state, account, order, "exception", key, "订单不属于当前作业站点");
  if (BLOCKED.has(order.status) || order.status === "completed" || record.stationStatus === "picked_up") return failure(state, account, order, "exception", key, "订单当前状态不能登记异常");
  Object.assign(record, { stationStatus: "exception", exceptionType: type, exceptionRemark: String(input.remark || "") });
  order.stationStatus = "exception";
  state.stationOrders ||= [];
  if (!state.stationOrders.includes(record)) state.stationOrders.unshift(record);
  const result = { ok: true, order: safeOrder(order, record), logId: null };
  const log = appendLog(state, { siteId: record.siteId, orderId, operatorId: account.id, action: "exception", result: "success", reason: record.exceptionRemark, idempotencyKey: key, response: result });
  result.logId = log.id;
  log.response = result;
  saveState();
  return result;
}

function logs(state, account, query = {}) {
  return (state.stationOperationLogs || []).filter((item) => siteIds(account).includes(item.siteId)).filter((item) => !query.orderId || item.orderId === query.orderId).slice(0, 200);
}

module.exports = { publicStation, dashboard, listOrders, findAccessibleOrder, receive, pickup, createException, logs, safeOrder };
