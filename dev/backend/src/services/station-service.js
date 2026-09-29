const { nextId, saveState } = require("../data/store");
const { verifyPickup } = require("../domain/fulfillment-rules");
const tickets = require("../repositories/ticket-repository");
const { canStation, publicStation } = require("../domain/station-accounts");
const { packagesFor, preparePackages, pickupVersion } = require("../domain/station-storage");

const RECEIVABLE = new Set(["paid"]);
const BLOCKED = new Set(["cancelled", "refunding", "refunded", "closed"]);

function siteIds(account) { return Array.isArray(account?.siteIds) ? account.siteIds : []; }

function allowedSite(account, siteId) {
  return siteIds(account).includes(String(siteId || ""));
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

function safeOrder(order, station = {}, state = {}) {
  if (!order) return null;
  const pickingItems = (order.items || []).map((item) => {
    const product = (state.products || []).find((row) => row.id === item.productId) || {};
    return {
      productId: item.productId,
      title: item.title || item.name || product.name || item.productId,
      quantity: item.quantity,
      barcode: product.barcode || product.pospalBarcode || "",
      locationCode: product.locationCode || "未配置库位",
      backupLocation: product.backupLocation || "",
      storageType: product.storageType || "ambient",
      pickSequence: Number.isSafeInteger(product.pickSequence) ? product.pickSequence : 0
    };
  }).sort((a, b) => a.pickSequence - b.pickSequence || String(a.locationCode).localeCompare(String(b.locationCode), "zh-CN", { numeric: true }));
  return {
    id: order.id,
    userId: order.userId,
    userPhone: order.userPhone ? maskPhone(order.userPhone) : "",
    items: order.items || [],
    pickingItems,
    cashAmount: order.cashAmount || 0,
    pointAmount: order.pointAmount || 0,
    paymentMode: order.paymentMode,
    status: order.status,
    fulfillmentType: order.fulfillmentType,
    pickupSiteId: orderSiteId(order),
    pickupCode: station.includePickupCode ? order.pickupCode : undefined,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt,
    stationStatus: effectiveStatus(order, station),
    shelfCode: station.shelfCode || "",
    packages: packagesFor(station),
    bagCount: packagesFor(station).reduce((total, row) => total + row.bagCount, 0),
    itemCount: (order.items || []).reduce((total, row) => total + Number(row.quantity || 0), 0),
    siteName: (state.pickupSites || []).find(site => site.id === orderSiteId(order))?.name || orderSiteId(order),
    receivedAt: station.receivedAt || "",
    holdUntil: station.holdUntil || "",
    overdue: order.status === "paid" && Boolean(station.holdUntil && new Date(station.holdUntil).getTime() <= Date.now()),
    pickerId: station.pickerId || "",
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

function validateReceivedItems(state, order, receivedItems) {
  if (receivedItems === undefined) return { ok: true, items: order.items || [] };
  if (!Array.isArray(receivedItems) || receivedItems.length !== (order.items || []).length) return { ok: false, error: "实收商品明细与订单不一致" };
  const expected = new Map((order.items || []).map((item) => [String(item.productId), Number(item.quantity)]));
  for (const item of receivedItems) {
    const productId = String(item?.productId || "");
    const quantity = Number(item?.quantity);
    if (!expected.has(productId) || !Number.isInteger(quantity) || quantity < 0 || quantity !== expected.get(productId)) return { ok: false, error: "实收商品数量与订单不一致" };
    expected.delete(productId);
    if (state.config?.stationScanRequired === true) {
      const product = (state.products || []).find((row) => row.id === productId) || {};
      const expectedBarcode = String(product.barcode || product.pospalBarcode || "").trim();
      if (!expectedBarcode || String(item?.barcode || "").trim() !== expectedBarcode) return { ok: false, error: "商品条码核对失败，请重新扫码" };
    }
  }
  return { ok: true, items: receivedItems };
}

function maskPhone(value) {
  const text = String(value || "");
  return text.length >= 7 ? `${text.slice(0, 3)}****${text.slice(-4)}` : text;
}

function effectiveStatus(order, record = {}) {
  if (BLOCKED.has(order.status)) return order.status;
  if (order.fulfillmentStatus === "picked_up") return "picked_up";
  return record.stationStatus || deriveStatus(order);
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
    const stationStatus = effectiveStatus(order, record);
    if (status && status !== "all" && status !== stationStatus && status !== order.fulfillmentStatus) return false;
    if (!keyword) return true;
    const productValues = (order.items || []).flatMap((item) => {
      const product = (state.products || []).find((row) => row.id === item.productId) || {};
      return [item.title || item.name || item.productId, product.locationCode, product.backupLocation, product.barcode || product.pospalBarcode];
    });
    return [order.id, order.userId, order.pickupSiteId, ...packagesFor(record).map(row => row.shelfCode), ...productValues].some((value) => String(value || "").toLowerCase().includes(keyword));
  }).map((order) => safeOrder(order, stationOrder(state, order), state)).sort((a, b) => {
    if (state.config?.stationBatchPickingEnabled !== false && state.config?.stationSortMode === "location") {
      const aLocation = a.pickingItems?.[0]?.locationCode || "";
      const bLocation = b.pickingItems?.[0]?.locationCode || "";
      const locationResult = aLocation.localeCompare(bLocation, "zh-CN", { numeric: true });
      if (locationResult) return locationResult;
    }
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
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
    pickingConfig: {
      enabled: state.config?.stationPickingEnabled !== false,
      batchEnabled: state.config?.stationBatchPickingEnabled !== false,
      scanRequired: state.config?.stationScanRequired === true,
      sortMode: state.config?.stationSortMode || "location",
      shelfPrefix: state.config?.stationShelfPrefix || "S-",
      pickupHoldHours: state.config?.stationPickupHoldHours || 48
    },
    counts: {
      pendingReceive: orders.filter((item) => ["expected", "in_transit", "picking"].includes(item.stationStatus) && item.status === "paid").length,
      readyPickup: orders.filter((item) => ["received", "ready"].includes(item.stationStatus)).length,
      todayPickedUp: orders.filter((item) => item.stationStatus === "picked_up" && String(item.pickedUpAt || "").startsWith(today)).length,
      exceptions: orders.filter((item) => item.status === "paid" && (item.stationStatus === "exception" || item.overdue)).length
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
  if (!canStation(account, "station:receive")) return { ok: false, status: 403, error: "没有收货权限" };
  const order = findAccessibleOrder(state, account, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在或不属于当前站点" };
  const key = String(input.idempotencyKey || `receive:${account.id}:${orderId}`);
  const replay = idempotentResult(state, key, account, order.id, "receive");
  if (replay) return replay;
  if (state.config?.stationPickingEnabled === false) return { ok: false, status: 409, error: "站点拣货功能暂未开启" };
  if (!RECEIVABLE.has(order.status) || BLOCKED.has(order.status)) return failure(state, account, order, "receive", key, "订单未支付或当前状态不允许收货");
  if (order.fulfillmentStatus !== "pending_pickup") return failure(state, account, order, "receive", key, "订单不是待自提状态或已经收货");
  const requestedSite = input.siteId === undefined ? orderSiteId(order) : String(input.siteId);
  if (requestedSite !== orderSiteId(order) || !allowedSite(account, requestedSite)) return failure(state, account, order, "receive", key, "订单不属于当前作业站点");
  const condition = String(input.condition || "normal");
  if (!["normal", "shortage", "damaged", "quantity_mismatch"].includes(condition)) return { ok: false, status: 400, error: "货物状态无效" };
  const record = stationOrder(state, order) || { orderId: order.id, siteId: orderSiteId(order) };
  if (["received", "ready", "picked_up", "completed"].includes(record.stationStatus)) return failure(state, account, order, "receive", key, "订单已经完成收货，不能重复收货");
  if (condition !== "normal") return createException(state, account, orderId, { ...input, idempotencyKey: `${key}:exception`, type: condition });
  if (state.config?.stationScanRequired === true && input.receivedItems === undefined) return failure(state, account, order, "receive", key, "当前配置要求扫码核对全部商品");
  const quantities = validateReceivedItems(state, order, input.receivedItems);
  if (!quantities.ok) return failure(state, account, order, "receive", key, quantities.error);
  if (record.pickerId && record.pickerId !== account.id) return { ok: false, status: 409, error: "订单由其他工作人员拣货，请联系其释放任务" };
  const storage = preparePackages(state, order, input, record);
  if (!storage.ok) return storage;
  record.packages = storage.packages;
  record.pickupLookupRequired = record.pickupLookupRequired || input.packages !== undefined;
  input = { ...input, shelfCode: storage.packages[0].shelfCode };
  Object.assign(record, { siteId: orderSiteId(order), stationStatus: condition === "normal" ? "ready" : "exception", shelfCode: String(input.shelfCode || ""), receivedItems: quantities.items, receivedAt: new Date().toISOString(), receivedBy: account.id, exceptionType: condition === "normal" ? "" : condition, exceptionRemark: String(input.remark || "") });
  order.stationStatus = record.stationStatus;
  order.stationReceivedAt = record.receivedAt;
  record.holdUntil ||= new Date(Date.now() + Number(state.config.stationPickupHoldHours || 48) * 3600000).toISOString();
  state.stationOrders ||= [];
  if (!state.stationOrders.includes(record)) state.stationOrders.unshift(record);
  tickets.resolveLinked(state, "station_exception", order.id, "商品已重新核对并完成上架", account.id);
  const result = { ok: true, order: safeOrder(order, record, state), logId: null };
  const log = appendLog(state, { siteId: record.siteId, orderId: order.id, operatorId: account.id, action: "receive", result: "success", reason: input.remark || "", idempotencyKey: key, response: result });
  result.logId = log.id;
  log.response = result;
  saveState();
  return result;
}

function lookupPickup(state, account, input = {}) {
  if (!canStation(account, "station:pickup")) return { ok: false, status: 403, error: "没有提货核验权限" };
  const code = typeof input.pickupCode === "string" ? input.pickupCode.trim() : "";
  const id = typeof input.orderId === "string" ? input.orderId.trim() : "";
  if (!code || code.length > 128) return { ok: false, status: 400, error: "请输入有效的提货码" };
  const matches = (state.orders || []).filter(order => siteOrderAllowed(account, order) && (!id || order.id === id) && String(order.pickupCode || "") === code && order.status === "paid" && order.fulfillmentStatus === "pending_pickup" && ["ready", "received"].includes(stationOrder(state, order)?.stationStatus));
  if (!matches.length) return { ok: false, status: 404, error: "取货码不正确或订单尚未收货、已提货，请核对当前站点" };
  if (matches.length !== 1) return { ok: false, status: 409, error: "提货码对应多张订单，请补充完整订单号", requiresOrderId: true };
  const order = matches[0], record = stationOrder(state, order);
  return { ok: true, order: safeOrder(order, record, state), pickupVersion: pickupVersion(order, record) };
}

function pickup(state, account, orderId, input = {}) {
  if (!canStation(account, "station:pickup")) return { ok: false, status: 403, error: "没有提货核验权限" };
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
  // Older clients retain the original code-verification contract. New clients
  // acknowledge the exact packages displayed by the read-only lookup first.
  if (record.pickupLookupRequired || input.pickupVersion !== undefined || input.confirmedPackageIds !== undefined) {
    if (input.pickupVersion !== pickupVersion(order, record)) return { ok: false, status: 409, error: "货物位置或清单已变化，请重新查找并核对" };
    const packages = packagesFor(record), checkedIds = input.confirmedPackageIds;
    if (!packages.length || !Array.isArray(checkedIds) || checkedIds.length !== packages.length || new Set(checkedIds).size !== packages.length || packages.some(row => !checkedIds.includes(row.id))) return { ok: false, status: 400, error: "请核对全部存放位置和袋数后确认交付" };
  }
  const checked = verifyPickup(state, order.id, input.pickupCode, { operatorType: "station", operatorId: account.id });
  if (!checked.ok && !checked.idempotent) return failure(state, account, order, "pickup_verify", key, checked.error);
  record.stationStatus = "picked_up";
  record.pickedUpAt = new Date().toISOString();
  record.pickedUpBy = account.id;
  order.stationStatus = "picked_up";
  const result = { ok: true, order: safeOrder(order, record, state), logId: null };
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
  if (!canStation(account, "station:exception")) return { ok: false, status: 403, error: "没有异常登记权限" };
  const order = findAccessibleOrder(state, account, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在或不属于当前站点" };
  const type = String(input.type || "unknown");
  const key = String(input.idempotencyKey || `exception:${account.id}:${orderId}:${type}`);
  const replay = idempotentResult(state, key, account, order.id, "exception");
  if (replay) return replay;
  const record = stationOrder(state, order) || { orderId: order.id, siteId: orderSiteId(order) };
  if (input.siteId !== undefined && String(input.siteId) !== orderSiteId(order)) return failure(state, account, order, "exception", key, "订单不属于当前作业站点");
  if (order.status !== "paid" || record.stationStatus === "picked_up") return failure(state, account, order, "exception", key, "订单当前状态不能登记异常");
  if (record.pickerId && record.pickerId !== account.id && ["picking", "exception"].includes(record.stationStatus)) return { ok: false, status: 409, error: "请由当前拣货人员处理异常或释放任务" };
  Object.assign(record, { stationStatus: "exception", pickerId: "", exceptionType: type, exceptionRemark: String(input.remark || "") });
  order.stationStatus = "exception";
  state.stationOrders ||= [];
  if (!state.stationOrders.includes(record)) state.stationOrders.unshift(record);
  const ticket = tickets.createLinked(state, { userId: order.userId, linkedType: "station_exception", linkedId: order.id, subject: `站点异常 ${order.id}`, content: `${type}：${record.exceptionRemark}`, priority: "high" });
  Object.assign(ticket, { status: "open", content: `${type}：${record.exceptionRemark}`, updatedAt: new Date().toISOString() });
  const result = { ok: true, order: safeOrder(order, record, state), logId: null };
  const log = appendLog(state, { siteId: record.siteId, orderId, operatorId: account.id, action: "exception", result: "success", reason: record.exceptionRemark, idempotencyKey: key, response: result });
  result.logId = log.id;
  log.response = result;
  saveState();
  return result;
}

function claim(state, account, orderId, input = {}) {
  if (!canStation(account, "station:receive")) return { ok: false, status: 403, error: "没有收货权限" };
  const order = findAccessibleOrder(state, account, orderId);
  if (!order) return { ok: false, status: 404, error: "订单不存在或不属于当前站点" };
  const record = stationOrder(state, order) || { orderId, siteId: orderSiteId(order) };
  if ((!input.release && state.config.stationPickingEnabled === false) || order.status !== "paid" || !["expected", "in_transit", "picking", "exception"].includes(effectiveStatus(order, record))) return { ok: false, status: 409, error: "当前订单不可拣货" };
  if (record.pickerId && record.pickerId !== account.id) return { ok: false, status: 409, error: "其他工作人员已领取此订单" };
  if (input.release) { record.pickerId = ""; record.stationStatus = record.exceptionType ? "exception" : "expected"; }
  else { record.pickerId = account.id; record.stationStatus = "picking"; }
  order.stationStatus = record.stationStatus;
  state.stationOrders ||= [];
  if (!state.stationOrders.includes(record)) state.stationOrders.push(record);
  appendLog(state, { siteId: record.siteId, orderId, operatorId: account.id, action: input.release ? "picking.release" : "picking.claim", result: "success" });
  saveState();
  return { ok: true, order: safeOrder(order, record, state) };
}

function logs(state, account, query = {}) {
  return (state.stationOperationLogs || []).filter((item) => siteIds(account).includes(item.siteId)).filter((item) => !query.orderId || item.orderId === query.orderId).slice(0, 200);
}

module.exports = { publicStation, dashboard, listOrders, findAccessibleOrder, receive, pickup, lookupPickup, createException, logs, safeOrder, claim };
