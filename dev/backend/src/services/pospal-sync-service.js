const { nextId } = require("../data/store");
const inventoryRepository = require("../repositories/inventory-repository");
const { createPospalClient, readConfig, isConfigured } = require("../integrations/pospal/pospal-client");

const DEFAULT_INTEGRATION = {
  account: "",
  cursors: {},
  productMappings: [],
  customerMappings: [],
  externalSales: [],
  externalOrders: [],
  callbackEvents: [],
  syncRuns: [],
  lastError: null,
  updatedAt: null
};

function integrationState(state) {
  state.config ||= {};
  const current = state.config.pospalIntegration || {};
  state.config.pospalIntegration = {
    ...DEFAULT_INTEGRATION,
    ...current,
    cursors: { ...(current.cursors || {}) },
    productMappings: Array.isArray(current.productMappings) ? current.productMappings : [],
    customerMappings: Array.isArray(current.customerMappings) ? current.customerMappings : [],
    externalSales: Array.isArray(current.externalSales) ? current.externalSales : [],
    externalOrders: Array.isArray(current.externalOrders) ? current.externalOrders : [],
    callbackEvents: Array.isArray(current.callbackEvents) ? current.callbackEvents : [],
    syncRuns: Array.isArray(current.syncRuns) ? current.syncRuns : []
  };
  return state.config.pospalIntegration;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function externalUid(item) {
  return item?.uid ?? item?.id ?? item?.customerUid ?? item?.productUid ?? null;
}

function resultList(response) {
  return Array.isArray(response?.result?.list) ? response.result.list : [];
}

function nextCursor(response, fallback) {
  return response?.result?.nextLastId ?? fallback;
}

async function readPages(fetchPage, initialBody, options = {}) {
  const maxPages = Math.max(1, Math.min(100, Number(options.maxPages || 10)));
  const items = [];
  let cursor = initialBody.lastId ?? 0;
  let pages = 0;
  let hasMore = true;
  while (hasMore && pages < maxPages) {
    const body = { ...initialBody, lastId: cursor };
    const response = await fetchPage(body);
    const pageItems = resultList(response);
    items.push(...pageItems);
    pages += 1;
    const next = nextCursor(response, cursor);
    hasMore = Boolean(response?.result?.hasMore) && String(next) !== String(cursor);
    cursor = next;
    if (!pageItems.length) hasMore = false;
  }
  return { items, cursor, pages, hasMore };
}

function productMatch(state, item, integration) {
  const uid = String(externalUid(item) || "");
  const barcode = String(item?.barcode || item?.productBarcode || "");
  const mapping = integration.productMappings.find(row =>
    (uid && String(row.pospalUid) === uid) || (barcode && row.barcode === barcode)
  );
  if (mapping) return { mapping, product: state.products.find(row => row.id === mapping.tggProductId) };
  const product = state.products.find(row =>
    (uid && String(row.pospalUid || "") === uid) || (barcode && String(row.pospalBarcode || "") === barcode)
  );
  return { mapping: null, product };
}

function addProductMapping(integration, item, product) {
  const row = {
    pospalUid: externalUid(item) == null ? "" : String(externalUid(item)),
    barcode: String(item?.barcode || item?.productBarcode || ""),
    tggProductId: product?.id || "",
    lastSyncAt: new Date().toISOString()
  };
  const existing = integration.productMappings.findIndex(item =>
    (row.pospalUid && item.pospalUid === row.pospalUid) || (row.barcode && item.barcode === row.barcode)
  );
  if (existing >= 0) integration.productMappings[existing] = { ...integration.productMappings[existing], ...row };
  else integration.productMappings.push(row);
  return row;
}

function createUnpublishedProduct(state, item) {
  const key = String(externalUid(item) || item?.barcode || item?.productBarcode || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!key) return null;
  const product = {
    id: `pospal_${key}`,
    pospalUid: externalUid(item) == null ? "" : String(externalUid(item)),
    pospalBarcode: String(item?.barcode || item?.productBarcode || ""),
    name: String(item?.name || item?.productName || "POSPAL商品"),
    category: String(item?.categoryName || item?.category || "未分类"),
    cashPrice: Number.isFinite(Number(item?.sellPrice)) ? Number(item.sellPrice) : null,
    pointsPrice: 0,
    stock: Number(item?.stock || 0),
    tag: "POSPAL待审核",
    image: item?.image || item?.imageUrl || "",
    supportsCash: Number.isFinite(Number(item?.sellPrice)),
    supportsPoints: false,
    purePointsOnly: false,
    status: "off",
    pospalLastSyncAt: new Date().toISOString()
  };
  if (!state.products.some(row => row.id === product.id)) state.products.push(product);
  return product;
}

async function syncProducts(state, client, options = {}) {
  const integration = integrationState(state);
  const start = options.resetCursor ? 0 : integration.cursors.products || 0;
  const page = await readPages(body => client.queryProducts({
    ...body,
    order: "asc",
    limit: Math.min(100, Number(options.limit || 100)),
    needImages: true,
    needCategory: true,
    needCustomerPrice: true
  }), { account: client.config.account, lastId: start }, options);
  let matched = 0;
  let created = 0;
  let unmatched = 0;
  for (const item of page.items) {
    const found = productMatch(state, item, integration);
    let product = found.product;
    if (!product && options.autoCreate) {
      product = createUnpublishedProduct(state, item);
      if (product) created += 1;
    }
    if (product) {
      matched += 1;
      product.pospalUid = String(externalUid(item) || product.pospalUid || "");
      product.pospalBarcode = String(item?.barcode || item?.productBarcode || product.pospalBarcode || "");
      product.externalSellPrice = item?.sellPrice ?? product.externalSellPrice;
      product.externalCustomerPrice = item?.customerPrice ?? product.externalCustomerPrice;
      product.pospalLastSyncAt = new Date().toISOString();
      addProductMapping(integration, item, product);
    } else unmatched += 1;
  }
  integration.cursors.products = page.cursor;
  return { resource: "products", fetched: page.items.length, matched, created, unmatched, cursor: page.cursor, pages: page.pages, hasMore: page.hasMore };
}

async function syncInventory(state, client, options = {}) {
  const integration = integrationState(state);
  const start = options.resetCursor ? 0 : integration.cursors.inventory || 0;
  const page = await readPages(body => client.queryInventory(body), { account: client.config.account, lastId: start }, options);
  let matched = 0;
  let unmatched = 0;
  for (const item of page.items) {
    const barcode = String(item?.barcode || "");
    const mapping = integration.productMappings.find(row => row.barcode === barcode);
    const product = mapping && state.products.find(row => row.id === mapping.tggProductId);
    if (!product) { unmatched += 1; continue; }
    const before = Number(product.stock || 0);
    const after = Number(item?.stock || 0);
    if (options.apply !== false && before !== after) {
      product.stock = after;
      inventoryRepository.addEntry(state, {
        product,
        changeType: "pospal_sync",
        quantityDelta: after - before,
        stockBefore: before,
        stockAfter: after,
        reason: "POSPAL库存同步",
        operatorRoleId: "pospal"
      });
    }
    matched += 1;
  }
  integration.cursors.inventory = page.cursor;
  return { resource: "inventory", fetched: page.items.length, matched, unmatched, applied: options.apply !== false, cursor: page.cursor, pages: page.pages, hasMore: page.hasMore };
}

async function syncCustomers(state, client, options = {}) {
  const integration = integrationState(state);
  const start = options.resetCursor ? 0 : integration.cursors.customers || 0;
  const page = await readPages(body => client.queryCustomers({ ...body, needCustomerCategory: true, needCustomerExt: true }), { account: client.config.account, lastId: start }, options);
  let matched = 0;
  let unmatched = 0;
  for (const item of page.items) {
    const uid = String(externalUid(item) || "");
    const tel = normalizePhone(item?.tel || item?.phone);
    let mapping = integration.customerMappings.find(row => (uid && row.pospalUid === uid) || (tel && row.phone === tel));
    let user = mapping && state.users.find(row => row.id === mapping.tggUserId);
    if (!user && tel) user = state.users.find(row => normalizePhone(row.phone) === tel);
    if (user) {
      mapping = mapping || { tggUserId: user.id };
      mapping.pospalUid = uid;
      mapping.number = String(item?.number || "");
      mapping.phone = tel;
      mapping.lastSyncAt = new Date().toISOString();
      const index = integration.customerMappings.findIndex(row => row.tggUserId === user.id);
      if (index >= 0) integration.customerMappings[index] = { ...integration.customerMappings[index], ...mapping };
      else integration.customerMappings.push(mapping);
      user.pospalUid = uid;
      user.pospalNumber = mapping.number;
      user.pospalLastSyncAt = mapping.lastSyncAt;
      matched += 1;
    } else unmatched += 1;
  }
  integration.cursors.customers = page.cursor;
  return { resource: "customers", fetched: page.items.length, matched, unmatched, cursor: page.cursor, pages: page.pages, hasMore: page.hasMore };
}

async function syncTickets(state, client, options = {}) {
  const integration = integrationState(state);
  const start = options.resetCursor ? 0 : integration.cursors.tickets || 0;
  const page = await readPages(body => client.queryTickets({ ...body, needCustomerInfo: true, needTicketItems: true, needTicketPayments: true, needTicketRelations: true, needProductBarcode: true }), { account: client.config.account, lastId: start }, options);
  let inserted = 0;
  for (const item of page.items) {
    const key = String(item?.uid || item?.sn || item?.id || "");
    if (!key) continue;
    const existing = integration.externalSales.find(row => row.key === key);
    const record = {
      key,
      pospalUid: item?.uid == null ? "" : String(item.uid),
      sn: item?.sn || "",
      webOrderNo: item?.webOrderNo || "",
      customerUid: item?.customerUid == null ? "" : String(item.customerUid),
      totalAmount: item?.totalAmount ?? item?.amount ?? null,
      updatedAt: new Date().toISOString(),
      raw: item
    };
    if (existing) Object.assign(existing, record);
    else { integration.externalSales.unshift(record); inserted += 1; }
  }
  integration.cursors.tickets = page.cursor;
  return { resource: "tickets", fetched: page.items.length, inserted, cursor: page.cursor, pages: page.pages, hasMore: page.hasMore };
}

async function syncProductOrders(state, client, options = {}) {
  const integration = integrationState(state);
  const start = options.resetCursor ? 0 : integration.cursors.orders || 0;
  const page = await readPages(body => client.queryProductOrders({ ...body, needOrderItem: true }), { account: client.config.account, lastId: start }, options);
  let inserted = 0;
  for (const item of page.items) {
    const key = String(item?.orderNo || item?.id || item?.uid || "");
    if (!key) continue;
    const record = { key, orderNo: item?.orderNo || "", state: item?.state ?? null, updatedAt: new Date().toISOString(), raw: item };
    const existing = integration.externalOrders.find(row => row.key === key);
    if (existing) Object.assign(existing, record);
    else { integration.externalOrders.unshift(record); inserted += 1; }
  }
  integration.cursors.orders = page.cursor;
  return { resource: "orders", fetched: page.items.length, inserted, cursor: page.cursor, pages: page.pages, hasMore: page.hasMore };
}

async function pushOrderToPospal(state, client, orderId) {
  if (!client || !isConfigured(client.config)) return { ok: false, status: 503, error: "POSPAL配置不完整，需要POSPAL_APP_ID、POSPAL_APP_KEY和POSPAL_ACCOUNT" };
  const integration = integrationState(state);
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: "TGG订单不存在" };
  const existing = integration.externalOrders.find(item => item.tggOrderId === order.id && item.pushStatus === "success");
  if (existing) return { ok: true, idempotent: true, externalOrder: existing };
  if (order.status !== "paid") return { ok: false, status: 409, error: "只有已支付订单才能推送POSPAL" };
  if (!["cash"].includes(order.paymentMode)) return { ok: false, status: 409, error: "纯积分或积分加现金订单暂不自动推送POSPAL，避免支付金额不一致" };
  const items = [];
  for (const item of order.items || []) {
    const mapping = integration.productMappings.find(row => row.tggProductId === item.productId && row.barcode);
    if (!mapping) return { ok: false, status: 409, error: `商品 ${item.productId} 尚未建立POSPAL条码映射` };
    items.push({ productBarcode: mapping.barcode, productQuantity: item.quantity, comment: item.comment || "" });
  }
  const user = state.users.find(item => item.id === order.userId);
  const response = await client.createProductOrder({
    account: client.config.account,
    orderNo: order.id,
    contactName: user?.nickname || "TGG用户",
    contactTel: user?.phone || "",
    contactAddress: order.deliveryAddress || "",
    deliveryType: order.fulfillmentType === "delivery" ? 1 : 0,
    totalAmount: Number(order.cashAmount || 0),
    payType: 2,
    productOrderItems: items
  });
  const externalOrder = {
    key: String(response?.result?.orderNo || response?.result?.id || order.id),
    orderNo: response?.result?.orderNo || order.id,
    tggOrderId: order.id,
    state: response?.result?.state ?? null,
    pushStatus: "success",
    pushedAt: new Date().toISOString(),
    raw: response.result || {}
  };
  integration.externalOrders.unshift(externalOrder);
  return { ok: true, idempotent: false, externalOrder };
}

async function syncResources(state, resources, options = {}) {
  const config = readConfig(options.env || process.env);
  const client = options.client || createPospalClient({ config: { ...config, ...(options.config || {}) } });
  if (!isConfigured(client.config)) return { ok: false, status: 503, error: "POSPAL配置不完整，需要POSPAL_APP_ID、POSPAL_APP_KEY和POSPAL_ACCOUNT" };
  const integration = integrationState(state);
  integration.account = client.config.account;
  const selected = Array.isArray(resources) && resources.length ? resources : ["products", "inventory", "customers", "tickets", "orders"];
  const results = [];
  for (const resource of selected) {
    try {
      const result = resource === "products" ? await syncProducts(state, client, options)
        : resource === "inventory" ? await syncInventory(state, client, options)
        : resource === "customers" ? await syncCustomers(state, client, options)
        : resource === "tickets" ? await syncTickets(state, client, options)
        : resource === "orders" ? await syncProductOrders(state, client, options)
        : { resource, skipped: true, error: "不支持的同步资源" };
      results.push(result);
    } catch (error) {
      integration.lastError = { resource, code: error.code || "POSPAL_SYNC_ERROR", message: error.message, at: new Date().toISOString() };
      results.push({ resource, ok: false, error: error.message, code: error.code || "POSPAL_SYNC_ERROR" });
    }
  }
  const run = { id: nextId("pospal_sync"), resources: selected, results, createdAt: new Date().toISOString() };
  integration.syncRuns.unshift(run);
  integration.syncRuns = integration.syncRuns.slice(0, 50);
  integration.updatedAt = run.createdAt;
  const failed = results.filter(item => item.ok === false || item.error);
  return { ok: failed.length === 0, status: failed.length ? 502 : 200, account: client.config.account, results, runId: run.id, partialFailure: failed.length > 0 };
}

function getStatus(state, env = process.env) {
  const config = readConfig(env);
  const integration = integrationState(state);
  return {
    configured: isConfigured(config),
    account: config.account,
    baseUrl: config.baseUrl,
    appIdConfigured: Boolean(config.appId),
    appKeyConfigured: Boolean(config.appKey),
    cursors: integration.cursors,
    mappingCounts: {
      products: integration.productMappings.length,
      customers: integration.customerMappings.length,
      externalSales: integration.externalSales.length,
      externalOrders: integration.externalOrders.length
    },
    lastRun: integration.syncRuns[0] || null,
    lastError: integration.lastError,
    updatedAt: integration.updatedAt
  };
}

module.exports = {
  integrationState,
  readPages,
  syncProducts,
  syncInventory,
  syncCustomers,
  syncTickets,
  syncProductOrders,
  pushOrderToPospal,
  syncResources,
  getStatus
};
