process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createPospalClient, md5 } = require("../../src/integrations/pospal/pospal-client");
const { syncResources, pushOrderToPospal, getStatus } = require("../../src/services/pospal-sync-service");
const { checkPospal } = require("../../scripts/check-pospal");

test("POSPAL quota failure stays actionable in sync status and stops live checks", async () => {
  const client = createPospalClient({
    config: { appId: "app", appKey: "key", account: "store" },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: "error", errorCode: 4021, messages: ["Token余额不足"] }) })
  });
  const state = createSeed();
  const result = await syncResources(state, ["products"], { client });
  assert.equal(result.ok, false);
  assert.equal(result.results[0].errorCode, 4021);
  assert.equal(getStatus(state).lastError.errorCode, 4021);
  assert.equal(state.config.pospalIntegration.cursors.products, undefined);
  const reports = [];
  assert.equal(await checkPospal(client, row => reports.push(row)), false);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].errorCode, 4021);
});

test("POSPAL live check uses only read methods and reports no customer data", async () => {
  const calls = [];
  const client = { config: { baseUrl: "https://platform.pospal.cn", appId: "app", appKey: "secret", account: "store" } };
  for (const method of ["queryProducts", "queryStores", "queryInventory", "queryCustomers", "queryTickets", "queryProductOrders", "queryPaymentMethods"]) {
    client[method] = async body => {
      calls.push(method);
      assert.equal(body.limit, 1);
      return { result: { list: [{ phone: "private-phone" }], hasMore: false } };
    };
  }
  const reports = [];
  assert.equal(await checkPospal(client, row => reports.push(row)), true);
  assert.equal(calls.length, 7);
  assert.equal(reports.every(row => row.count === 1), true);
  assert.equal(JSON.stringify(reports).includes("private-phone"), false);
});

test("POSPAL client signs requests and always sends the configured account", async () => {
  let captured;
  const client = createPospalClient({
    config: { baseUrl: "https://platform.pospal.cn", appId: "app", appKey: "key", account: "store" },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => ({ status: "success", errorCode: 0, result: { list: [], hasMore: false, nextLastId: 0 } }) };
    }
  });

  await client.queryProducts({ lastId: 0, limit: 1 });
  const body = JSON.parse(captured.options.body);
  assert.equal(body.account, "store");
  assert.equal(captured.options.headers["X-App-Id"], "app");
  assert.match(captured.options.headers["X-Request-Id"], /^[0-9a-f-]{36}$/);
  assert.equal(captured.options.headers["X-Sign"].length, 32);
  assert.equal(captured.options.headers["X-Sign"], md5(`app|${captured.options.headers["X-Request-Id"]}|${captured.options.headers["X-Timestamp"]}|key`));
});

test("POSPAL sync maps products, inventory, members, sales and web orders idempotently", async () => {
  const state = createSeed();
  state.users[0].phone = "13800138000";
  let productCalls = 0;
  const client = {
    config: { baseUrl: "https://platform.pospal.cn", account: "store001", appId: "app", appKey: "key" },
    queryProducts: async body => {
      productCalls += 1;
      return productCalls === 1
        ? { status: "success", result: { list: [{ uid: "p-1", barcode: "690000000001", name: "POSPAL苹果", sellPrice: 6.5, stock: 4 }], hasMore: false, nextLastId: 1 } }
        : { status: "success", result: { list: [], hasMore: false, nextLastId: body.lastId } };
    },
    queryInventory: async () => ({ status: "success", result: { list: [{ barcode: "690000000001", stock: 7 }], hasMore: false, nextLastId: 2 } }),
    queryCustomers: async () => ({ status: "success", result: { list: [{ uid: "c-1", number: "VIP-1", tel: "13800138000", name: "张三" }], hasMore: false, nextLastId: 3 } }),
    queryTickets: async () => ({ status: "success", result: { list: [{ uid: "t-1", sn: "XS-1", totalAmount: 6.5 }], hasMore: false, nextLastId: 4 } }),
    queryProductOrders: async () => ({ status: "success", result: { list: [{ id: "o-1", orderNo: "WEB-1", state: 4 }], hasMore: false, nextLastId: 5 } })
  };

  const first = await syncResources(state, ["products", "inventory", "customers", "tickets", "orders"], { client, autoCreate: true, apply: true });
  assert.equal(first.ok, true);
  assert.equal(first.results.every(item => !item.error), true);
  assert.equal(state.config.pospalIntegration.productMappings.length, 1);
  assert.equal(state.config.pospalIntegration.customerMappings.length, 1);
  assert.equal(state.config.pospalIntegration.externalSales.length, 1);
  assert.equal(state.config.pospalIntegration.externalOrders.length, 1);
  const imported = state.products.find(item => item.pospalBarcode === "690000000001");
  assert.equal(imported.status, "off");
  assert.equal(imported.stock, 7);
  assert.equal(state.inventoryLedger.length, 1);
  assert.equal(state.users[0].pospalUid, "c-1");

  const second = await syncResources(state, ["tickets", "orders"], { client });
  assert.equal(second.ok, true);
  assert.equal(state.config.pospalIntegration.externalSales.length, 1);
  assert.equal(state.config.pospalIntegration.externalOrders.length, 1);
  const status = getStatus(state, { POSPAL_APP_ID: "app", POSPAL_APP_KEY: "key", POSPAL_ACCOUNT: "store001" });
  assert.equal(status.configured, true);
  assert.equal(status.mappingCounts.products, 1);
});

test("paid cash TGG orders push to POSPAL only with a barcode mapping and replay idempotently", async () => {
  const state = createSeed();
  const order = state.orders[0];
  state.config.pospalIntegration = {
    productMappings: [{ pospalUid: "p-1", barcode: "690000000001", tggProductId: "p_apple" }],
    externalOrders: []
  };
  let calls = 0;
  const client = {
    config: { baseUrl: "https://platform.pospal.cn", account: "store001", appId: "app", appKey: "key" },
    createProductOrder: async body => {
      calls += 1;
      assert.equal(body.orderNo, order.id);
      assert.equal(body.productOrderItems[0].productBarcode, "690000000001");
      return { status: "success", result: { orderNo: order.id, id: "po-1", state: 1 } };
    }
  };
  const first = await pushOrderToPospal(state, client, order.id);
  const second = await pushOrderToPospal(state, client, order.id);
  assert.equal(first.ok, true);
  assert.equal(second.idempotent, true);
  assert.equal(calls, 1);
});
