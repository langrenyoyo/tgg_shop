process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { recordPhone } = require("../../src/services/phone-binding-service");
const { expiryDate } = require("../../src/domain/pospal-membership");
const { createOrder } = require("../../src/domain/rules");
const { checkPurchaseEligibility } = require("../../src/services/purchase-eligibility-service");
const orders = require("../../src/services/order-service");
const payments = require("../../src/services/payment-service");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const state = createSeed(), user = state.users.find(row => row.id === "u_1002");
  Object.assign(user, { status: "active", role: "normal", memberUntil: new Date(Date.now() + 86400000).toISOString(), pospalUid: "900000000000000001", pospalNumber: "card-1" });
  recordPhone(state, user, "13912345678");
  const integration = state.config.pospalIntegration;
  integration.customerMappings = [{ tggUserId: user.id, pospalUid: user.pospalUid, number: user.pospalNumber, phone: user.phone, account: "store" }];
  const row = { uid: user.pospalUid, number: user.pospalNumber, tel: user.phone, expiryDate: expiryDate(user.memberUntil), enable: 1, isLoss: 0, active: 0 };
  const h = { state, user, integration, row, calls: [], payload: { paymentMode: "cash", items: [{ productId: "p_apple", quantity: 1 }], idempotencyKey: "purchase-1" } };
  h.client = { config: { baseUrl: "https://example.test", appId: "app", appKey: "secret", account: "store" }, async queryCustomers(body) { h.calls.push(body); return { result: { list: [structuredClone(row)], hasMore: false } }; } };
  h.check = () => checkPurchaseEligibility(state, user.id, { client: h.client });
  h.submit = () => orders.submitOrder(state, user.id, h.payload, { client: h.client });
  return h;
}

test("purchase checks the live store identity, phone and expiry even for registration-gift members", async () => {
  const h = setup(), before = JSON.stringify(h.state);
  assert.equal((await h.check()).ok, true);
  assert.equal(JSON.stringify(h.state), before, "checking cannot modify memberships, tasks, balances or cards");
  assert.deepEqual(h.calls[0], { number: h.user.pospalNumber, lastId: 0, limit: 100, needCustomerExt: true });
  h.row.tel = "13812345678";
  const result = await h.submit();
  assert.equal(result.status, 409); assert.match(result.error, /手机号/);
  assert.equal(JSON.stringify(h.state), before, "rejected checkout cannot reserve stock or points");
});

test("restored identity mappings work without mirrored user identifiers and conflicting mirrors are rejected", async () => {
  const h = setup();
  delete h.user.pospalUid; delete h.user.pospalNumber;
  assert.equal((await h.check()).ok, true);
  h.user.pospalNumber = "unrelated-card";
  assert.equal((await h.check()).status, 409);
  assert.equal(h.calls.length, 1);
});

test("purchase rejects expired or unverified members, missing associations, conflicts, configuration and quota pauses before lookup", async () => {
  const changes = [
    h => { h.user.memberUntil = "2000-01-01"; },
    h => { h.user.status = "disabled"; },
    h => { delete h.state.config.userPhoneVerifications[h.user.id]; },
    h => { delete h.user.pospalUid; delete h.integration.customerMappings[0].pospalUid; },
    h => { h.integration.customerMappings = []; },
    h => { h.integration.customerMappings.push({ ...h.integration.customerMappings[0] }); },
    h => { h.integration.customerMappings[0].phone = "13812345678"; },
    h => { h.state.users.push({ id: "other", phone: h.user.phone }); },
    h => { h.client.config.appKey = ""; },
    h => { h.integration.account = "another-store"; },
    h => { h.integration.membershipSyncQuotaUntil = new Date(Date.now() + 3600000).toISOString(); }
  ];
  for (const change of changes) {
    const h = setup(); change(h);
    const before = JSON.stringify(h.state), result = await h.check();
    assert.equal(result.ok, false); assert.equal(h.calls.length, 0);
    assert.equal(JSON.stringify(h.state), before);
  }
});

test("live lookup rejects missing, ambiguous, incomplete, disabled and stale-expiry store records", async () => {
  const responses = [
    () => ({ result: { list: [], hasMore: false } }),
    h => ({ result: { list: [h.row, h.row], hasMore: false } }),
    h => ({ result: { list: [h.row], hasMore: true } }),
    () => ({}),
    h => ({ result: { list: [{ ...h.row, enable: 0 }] } }),
    h => ({ result: { list: [{ ...h.row, isLoss: 1 }] } }),
    h => ({ result: { list: [{ ...h.row, active: 1 }] } }),
    h => ({ result: { list: [{ ...h.row, uid: "other" }] } }),
    h => ({ result: { list: [{ ...h.row, expiryDate: "2099-01-01 00:00:00" }] } })
  ];
  for (const response of responses) {
    const h = setup(); h.client.queryCustomers = async () => response(h);
    const before = JSON.stringify(h.state);
    assert.equal((await h.submit()).status, 409);
    assert.equal(JSON.stringify(h.state), before);
  }
});

test("provider errors fail closed with safe messages and never expose provider payloads", async () => {
  for (const errorCode of [4021, undefined]) {
    const h = setup(); h.client.queryCustomers = async () => { throw Object.assign(new Error("private-phone-secret"), { errorCode }); };
    const before = JSON.stringify(h.state), result = await h.submit();
    assert.equal(result.status, 503);
    assert.match(result.error, errorCode === 4021 ? /额度不足/ : /暂时无法核验/);
    assert.equal(result.error.includes("private-phone-secret"), false);
    assert.equal(JSON.stringify(h.state), before);
  }
});

test("membership, phone and mapping changes while the provider is responding prevent purchase", async () => {
  for (const change of [h => { h.user.memberUntil = "2000-01-01"; }, h => { h.user.memberUntil = new Date(Date.now() + 172800000).toISOString(); }, h => { h.user.phone = "13812345678"; }, h => { h.integration.customerMappings[0].account = "changed"; }]) {
    const h = setup(), original = h.client.queryCustomers;
    h.client.queryCustomers = async body => { const result = await original(body); change(h); return result; };
    const stock = h.state.products.find(row => row.id === "p_apple").stock, points = h.user.points, count = h.state.orders.length;
    assert.equal((await h.submit()).ok, false);
    assert.equal(h.state.orders.length, count); assert.equal(h.user.points, points);
    assert.equal(h.state.products.find(row => row.id === "p_apple").stock, stock);
  }
});

test("confirmed checkout succeeds; lost-response retries recover the original order without another provider call or deduction", async () => {
  const h = setup(), first = await h.submit();
  assert.equal(first.ok, true, first.error); assert.equal(first.order.membershipRequired, true);
  h.client.queryCustomers = async () => { throw new Error("offline"); };
  h.user.memberUntil = "2000-01-01";
  const before = JSON.stringify(h.state), replay = await h.submit();
  assert.equal(replay.idempotent, true); assert.equal(replay.order.id, first.order.id);
  assert.equal(JSON.stringify(h.state), before);
  const changed = await orders.submitOrder(h.state, h.user.id, { ...h.payload, items: [{ productId: "p_apple", quantity: 2 }] }, { client: h.client });
  assert.equal(changed.status, 409);
});

test("payment creation, including reusing a pending payment, and real payment initiation repeat the gate", async () => {
  const h = setup(), order = (await h.submit()).order;
  const first = await orders.createOrderPayment(h.state, order.id, { channel: "lfwin_wechat_mini" }, { client: h.client });
  assert.equal(first.ok, true);
  h.row.tel = "13812345678";
  const before = JSON.stringify(h.state);
  assert.equal((await orders.createOrderPayment(h.state, order.id, {}, { client: h.client })).status, 409);
  assert.equal((await orders.initiateLfwinPayment(h.state, first.payment.payNo, {}, { client: h.client })).status, 409);
  assert.equal(JSON.stringify(h.state), before, "no payment or provider submission state is created on rejection");
  h.user.memberUntil = "2000-01-01";
  assert.equal((await orders.createOrderPayment(h.state, order.id, {}, { client: h.client })).status, 400);
});

test("pure-points exchange and cash gift-only purchases keep their existing nonmember rules", async () => {
  const h = setup(); h.user.memberUntil = null; delete h.user.phone;
  h.client.queryCustomers = async () => { throw new Error("must not contact provider"); };
  const points = await orders.submitOrder(h.state, h.user.id, { paymentMode: "pure_points", items: [{ productId: "p_banana", quantity: 1 }] }, { client: h.client });
  assert.equal(points.ok, true, points.error); assert.equal(points.order.membershipRequired, false);
  const product = h.state.products.find(row => row.id === "p_apple");
  Object.assign(product, { category: "买商品送会员", membershipGiftDays: 30, supportsCash: true, purePointsOnly: false });
  const gift = await h.submit(); assert.equal(gift.ok, true, gift.error); assert.equal(gift.order.membershipRequired, false);
  product.category = "水果"; // Later product edits must not revoke the order's gift-only exemption.
  const paid = await orders.createOrderPayment(h.state, gift.order.id, { channel: "lfwin_wechat_mini" }, { client: h.client });
  assert.equal(paid.ok, true, paid.error);
});

test("client supplied exemption cannot bypass normal cash or mixed checkout, including a basket containing gift goods", async () => {
  const h = setup(); h.integration.customerMappings = [];
  h.payload.membershipRequired = false;
  assert.equal((await h.submit()).status, 409);
  h.payload.paymentMode = "points_plus_cash";
  assert.equal((await h.submit()).status, 409);
  h.payload.paymentMode = "cash";
  const gift = { ...h.state.products.find(row => row.id === "p_apple"), id: "gift", category: "买商品送会员", membershipGiftDays: 30 };
  h.state.products.push(gift); h.payload.items.push({ productId: gift.id, quantity: 1 });
  assert.equal((await h.submit()).status, 409);
});

test("historical pending orders are gated, while paid payment recovery stays idempotent", async () => {
  const h = setup(), order = createOrder(h.state, h.user.id, h.payload).order;
  delete order.membershipRequired; h.integration.customerMappings = [];
  assert.equal((await orders.createOrderPayment(h.state, order.id, {}, { client: h.client })).status, 409);
  const payment = payments.createGoodsPayment(h.state, order.id, { channel: "lfwin_wechat_mini" }).payment;
  payment.status = "paid"; order.status = "paid";
  const result = await orders.createOrderPayment(h.state, order.id, {}, { client: h.client });
  assert.equal(result.idempotent, true); assert.equal(result.payment.id, payment.id);
});

test("HTTP checkout waits for the live lookup and returns its rejection before mutation", async () => {
  const h = setup();
  let finishLookup, response;
  h.client.queryCustomers = () => new Promise(resolve => { finishLookup = resolve; });
  const context = { module: { exports: {} }, require(name) {
    if (name === "../services/order-service") return { ...orders, submitOrder: (state, userId, payload) => orders.submitOrder(state, userId, payload, { client: h.client }) };
    if (name === "../data/store") return { saveState: async () => {} };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../src/routes/order-routes.js"), "utf8"), context);
  const before = JSON.stringify(h.state);
  const pending = context.module.exports.handleOrderRoutes({
    req: { method: "POST" }, url: new URL("https://example.test/api/orders"), state: h.state, user: h.user,
    readBody: async () => h.payload, send: (_, status, body) => { response = { status, body }; }
  });
  await new Promise(setImmediate);
  assert.equal(response, undefined); assert.equal(JSON.stringify(h.state), before);
  finishLookup({ result: { list: [{ ...h.row, tel: "13812345678" }], hasMore: false } });
  await pending;
  assert.equal(response.status, 409); assert.match(response.body.error, /手机号/);
  assert.equal(JSON.stringify(h.state), before);
});
