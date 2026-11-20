process.env.TGG_STORE_MODE = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../../src/data/seed');
const model = require('../../src/domain/wechat-orders');
const service = require('../../src/services/wechat-order-service');
const { createOrderClient, failure } = require('../../src/integrations/wechat/order-client');
const payments = require('../../src/services/payment-service');
const goodsPayment = require('../helpers/goods-payment');
const { shipOrder, deliverOrder, verifyPickup, autoConfirmDeliveryOrders } = require('../../src/domain/fulfillment-rules');
const { activeConfig } = require('../../src/config/active-config');
const { validateRuntimeConfig } = require('../../src/config/runtime-config');
const { handleWechatOrderRoutes } = require('../../src/routes/wechat-order-routes');
const { issueToken } = require('../../src/domain/auth');

const transactionId = '4200001234202611201234567890';
const env = { WECHAT_APPID: 'wx-order-app', WECHAT_APPSECRET: 'private-secret', WECHAT_ORDER_MANAGEMENT_ENABLED: '1' };
function fixture(type = 'pickup') {
  const state = createSeed(), payment = goodsPayment(state), order = state.orders.find(o => o.id === payment.orderId);
  const user = state.users.find(u => u.id === order.userId);
  user.wechatOpenid = 'private-payer';
  payment.metadata.lfwin = { providerOrderNo: 'lfwin-platform-order' };
  model.captureRequestIdentity(state, payment, { method: 'wechat_mini', appId: env.WECHAT_APPID, openId: user.wechatOpenid });
  const result = payments.applyLfwinPaymentNotification(state, { mch_orderid: payment.payNo, orderid: 'lfwin-platform-order',
    trade_no: transactionId, paystatus: '1', paymoney: String(payment.amount) }, { verifyNotification: () => true });
  assert.equal(result.ok, true);
  if (type === 'delivery') { order.fulfillmentType = 'delivery'; order.fulfillmentStatus = 'pending_ship'; }
  return { state, order, payment, user };
}
function harness(f, options = {}) {
  let time = Date.parse('2026-11-20T15:00:00Z'), remoteState = 1, uploads = 0, queries = 0, saves = 0;
  const requests = [];
  const remote = () => ({ order: { transaction_id: transactionId, openid: 'private-payer', paid_amount: Math.round(f.payment.amount * 100),
    order_state: remoteState, ...(remoteState !== 1 ? { shipping: { finish_shipping: true, delivery_mode: 1, logistics_type: f.order.fulfillmentType === 'pickup' ? 4 : 2 } } : {}) } });
  const client = { appId: () => env.WECHAT_APPID, managementStatus: async () => ({ tradeManaged: true, confirmationCompleted: true }),
    getOrder: async () => { queries++; return remote(); },
    uploadShipping: async body => { uploads++; requests.push(body); remoteState = 2; }, ...options.client };
  const save = options.save || (async () => { saves++; });
  const now = () => time;
  const worker = service.createWorker({ state: () => f.state, save, now, client, enabled: () => true });
  return { worker, client, now, save, requests, remote, get uploads() { return uploads; }, get queries() { return queries; }, get saves() { return saves; },
    advance(ms = 360000) { time += ms; }, setRemote(value) { remoteState = value; } };
}
function ready(f) { f.order.stationStatus = 'ready'; model.enqueue(f.state, f.order); }

test('payer snapshot is private, verified LFWin settlement captures only the upstream transaction, and duplicate settlement cannot replace it', () => {
  const f = fixture();
  assert.equal(f.state.config.wechatOrders.payments[f.payment.payNo].transactionId, transactionId);
  assert.equal(JSON.stringify(activeConfig(f.state.config)).includes('private-payer'), false);
  assert.equal(JSON.stringify(payments.listUserPayments(f.state, f.user.id)).includes('private-payer'), false);
  const response = { mch_orderid: f.payment.payNo, orderid: 'lfwin-platform-order', trade_no: transactionId + '9', paystatus: '1', paymoney: String(f.payment.amount) };
  assert.equal(payments.applyLfwinPaymentNotification(f.state, response, { verifyNotification: () => true }).ok, false);
  assert.equal(model.capturePaymentIdentity(f.state, f.payment, { trade_no: 'lfwin-platform-order' }), true);
  assert.equal(f.state.config.wechatOrders.payments[f.payment.payNo].transactionId, transactionId);
});

test('pickup waits for goods at station; uploads the real transaction with logistics=4 once, including after restart', async () => {
  const f = fixture(), h = harness(f);
  await h.worker.run(); assert.equal(h.uploads, 0);
  assert.equal(f.state.config.wechatOrders.management.confirmationCompleted, true, 'authorization is checked before the first shipping job');
  ready(f);
  await Promise.all([h.worker.run(), h.worker.run()]);
  assert.equal(h.uploads, 1);
  const body = h.requests[0];
  assert.deepEqual(body.order_key, { order_number_type: 2, transaction_id: transactionId });
  assert.equal(body.logistics_type, 4); assert.equal(body.delivery_mode, 1);
  assert.equal(body.payer.openid, 'private-payer');
  assert.equal(body.shipping_list[0].item_desc.includes('×1'), true);
  assert.equal(body.shipping_list[0].tracking_no, undefined);
  assert.equal(f.state.config.wechatOrders.jobs[f.order.id].status, 'synced');
  h.advance();
  const restarted = service.createWorker({ state: () => f.state, save: h.save, now: h.now, client: h.client, enabled: () => true });
  await restarted.run(); assert.equal(h.uploads, 1);
});

test('delivery dispatch queues logistics=2 and missing authorization blocks external uploads', async () => {
  const f = fixture('delivery');
  const staff = f.state.deliveryStaff.find(s => s.enabled && f.state.deliveryTeams.some(t => t.id === s.teamId && t.enabled));
  assert.equal(shipOrder(f.state, f.order.id, staff.id).ok, true);
  assert.ok(f.state.config.wechatOrders.jobs[f.order.id]);
  const h = harness(f, { client: { managementStatus: async () => ({ tradeManaged: true, confirmationCompleted: false }) } });
  await h.worker.run(); assert.equal(h.uploads, 0); assert.equal(h.queries, 0);
  assert.equal(model.summary(f.state, f.order).lastError.code, 'authorization');
  h.client.managementStatus = async () => ({ tradeManaged: true, confirmationCompleted: true });
  h.advance(); await h.worker.run();
  assert.equal(h.uploads, 1); assert.equal(h.requests[0].logistics_type, 2);
});

test('unpaid, pure-points, refunded and cancelled orders never enter shipping uploads', async () => {
  for (const kind of ['pending', 'pure_points', 'refunded', 'cancelled']) {
    const f = fixture(); ready(f);
    if (kind === 'pending') f.payment.status = 'pending';
    else if (kind === 'pure_points') { f.payment.channel = 'points'; f.order.paymentMode = 'pure_points'; }
    else f.order.status = kind;
    // Discard previous job to emulate startup scanning of existing orders.
    f.state.config.wechatOrders.jobs = {};
    const h = harness(f); await h.worker.run(); assert.equal(h.uploads, 0, kind);
  }
});

test('transaction, payer, amount, app and existing shipping mismatches cannot trigger upload or complete local delivery', async () => {
  for (const field of ['transaction_id', 'openid', 'paid_amount', 'appid', 'logistics_type']) {
    const f = fixture('delivery'); f.order.fulfillmentStatus = 'delivered'; model.enqueue(f.state, f.order);
    const h = harness(f);
    h.client.getOrder = async () => {
      const r = h.remote();
      if (field === 'appid') f.state.config.wechatOrders.payments[f.payment.payNo].appId = 'other-app';
      else if (field === 'logistics_type') { r.order.order_state = 3; r.order.shipping = { finish_shipping: true, delivery_mode: 1, logistics_type: 1 }; }
      else r.order[field] = field === 'paid_amount' ? 1 : 'other-value';
      return r;
    };
    if (field === 'appid') f.state.config.wechatOrders.payments[f.payment.payNo].appId = 'other-app';
    await h.worker.run(); assert.equal(h.uploads, 0, field); assert.equal(f.order.status, 'paid', field);
    assert.equal(model.summary(f.state, f.order).status, 'blocked', field);
  }
});

test('a timed out upload is reconciled without resending; explicit review requires unshipped state and never overwrites delivered shipping', async () => {
  const f = fixture(); ready(f);
  let sends = 0;
  const h = harness(f, { client: { uploadShipping: async () => { sends++; throw failure('network', 'secret-token-and-openid'); } } });
  await h.worker.run(); assert.equal(sends, 1);
  assert.equal(model.summary(f.state, f.order).status, 'uncertain');
  assert.equal(JSON.stringify(model.summary(f.state, f.order)).includes('secret-token-and-openid'), false);
  h.advance(); await h.worker.run(); assert.equal(sends, 1);
  const options = { client: h.client, save: h.save, now: h.now };
  assert.equal((await service.retry(f.state, f.order.id, { reason: 'reviewed' }, { adminId: 'admin' }, options)).status, 409);
  assert.equal((await service.retry(f.state, f.order.id, { reason: 'reviewed', confirmUnshipped: true }, { adminId: 'admin' }, options)).ok, true);
  await h.worker.run(); assert.equal(sends, 2);
  h.setRemote(2); h.advance(); await h.worker.run(); assert.equal(sends, 2);
  assert.equal(model.summary(f.state, f.order).status, 'synced');
});

test('durability failures stop the worker before uploads and also after provider acceptance', async () => {
  for (const stage of ['sending', 'synced']) {
    const f = fixture(); ready(f);
    let fail = true;
    const h = harness(f, { save: async () => { if (fail && f.state.config.wechatOrders.jobs[f.order.id].status === stage) throw Error('disk failed'); } });
    await assert.rejects(h.worker.run(), /disk failed/);
    assert.equal(h.uploads, stage === 'sending' ? 0 : 1);
    fail = false; h.advance(); await h.worker.run();
    assert.equal(h.uploads, stage === 'sending' ? 0 : 1, 'worker remains paused after storage failure');
  }
});

test('receipt component parameters enforce owner and physical delivery; only verified WeChat receipt completes local delivery', async () => {
  const f = fixture('delivery'); f.order.fulfillmentStatus = 'shipping'; model.enqueue(f.state, f.order);
  const h = harness(f); await h.worker.run();
  assert.equal(service.receiptInfo(f.state, 'other-user', f.order.id, env).status, 404);
  assert.equal(service.receiptInfo(f.state, f.user.id, f.order.id, env).status, 409);
  assert.equal(deliverOrder(f.state, f.order.id).ok, true);
  const info = service.receiptInfo(f.state, f.user.id, f.order.id, env);
  assert.deepEqual(info.extraData, { transaction_id: transactionId });
  assert.equal(JSON.stringify(info).includes('private-payer'), false);
  const options = { client: h.client, save: h.save, now: h.now, env };
  assert.equal((await service.reconcileReceipt(f.state, f.user.id, f.order.id, options)).confirmed, false);
  assert.equal(f.order.status, 'paid');
  const balance = f.user.points, ledger = f.state.paymentLedger.length;
  h.setRemote(3);
  assert.equal((await service.reconcileReceipt(f.state, f.user.id, f.order.id, options)).confirmed, true);
  assert.equal(f.order.status, 'completed'); assert.equal(f.user.points, balance); assert.equal(f.state.paymentLedger.length, ledger);
  assert.ok(model.summary(f.state, f.order).receiptConfirmedAt);
});

test('pickup verification keeps official receipt separate and enabled managed orders skip the local auto-confirm timer', async () => {
  const f = fixture(); ready(f);
  assert.equal(verifyPickup(f.state, f.order.id, f.order.pickupCode).ok, true);
  assert.equal(f.order.status, 'completed'); assert.equal(model.summary(f.state, f.order).receiptConfirmedAt, null);
  const d = fixture('delivery'); d.order.fulfillmentStatus = 'delivered'; d.order.deliveredAt = '2020-01-01T00:00:00Z';
  const old = process.env.WECHAT_ORDER_MANAGEMENT_ENABLED;
  process.env.WECHAT_ORDER_MANAGEMENT_ENABLED = '1';
  try { autoConfirmDeliveryOrders(d.state); assert.equal(d.order.status, 'paid'); }
  finally { if (old === undefined) delete process.env.WECHAT_ORDER_MANAGEMENT_ENABLED; else process.env.WECHAT_ORDER_MANAGEMENT_ENABLED = old; }
});

test('order client uses stable cached tokens, refreshes expired tokens safely and never exposes provider payloads', async () => {
  let tokens = 0, queries = 0;
  const client = createOrderClient({ env, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('stable_token')) {
      tokens++; assert.equal(body.force_refresh, false);
      return { ok: true, json: async () => ({ access_token: 'private-token-' + tokens, expires_in: 7200 }) };
    }
    queries++;
    return { ok: true, json: async () => queries === 1 ? { errcode: 42001, errmsg: 'private-token-and-user' } : { errcode: 0, order: {} } };
  } });
  await client.getOrder(transactionId); await client.getOrder(transactionId);
  assert.equal(tokens, 2); assert.equal(queries, 3);
  const broken = createOrderClient({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ errcode: 61003, errmsg: 'private-secret' }) }) });
  await assert.rejects(broken.getOrder(transactionId), error => error.code === '61003' && !error.message.includes('private-secret'));
  const emptyAck = createOrderClient({ env, fetchImpl: async url => ({ ok: true, json: async () => url.endsWith('stable_token') ? { access_token: 'private', expires_in: 7200 } : {} }) });
  await assert.rejects(emptyAck.uploadShipping({}), error => error.code === 'network');
  assert.equal(validateRuntimeConfig({ WECHAT_ORDER_MANAGEMENT_ENABLED: '1' }, false).errors.includes('WECHAT_APPID and WECHAT_APPSECRET are required for WeChat order management'), true);
});

test('a platform receipt cannot complete a delivery still in transit; reconciliation resumes after actual delivery', async () => {
  const f = fixture('delivery'); f.order.fulfillmentStatus = 'shipping'; model.enqueue(f.state, f.order);
  const h = harness(f); h.setRemote(3);
  await h.worker.run();
  assert.equal(f.order.status, 'paid'); assert.equal(model.summary(f.state, f.order).receiptConfirmedAt, null);
  deliverOrder(f.state, f.order.id); h.advance(); await h.worker.run();
  assert.equal(f.order.status, 'completed'); assert.ok(model.summary(f.state, f.order).receiptConfirmedAt);
});

test('routes enforce ownership and integration permissions without exposing private state', async () => {
  const f = fixture(); ready(f);
  async function route(path, method = 'GET', role, body = {}) {
    const req = { method, headers: {} };
    if (role) {
      const token = issueToken({ type: 'admin', roleId: role });
      const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url'));
      f.state.authSessions.push({ subjectType: 'admin', subjectId: role, tokenId: payload.tokenId, expiresAt: new Date(payload.exp * 1000).toISOString() });
      req.headers.authorization = 'Bearer ' + token;
    }
    let response;
    await handleWechatOrderRoutes({ req, res: {}, url: new URL('http://localhost' + path), state: f.state,
      user: { id: 'other-user' }, readBody: async () => body, send: (res, status, body) => { response = { status, body }; return true; } });
    return response;
  }
  assert.equal((await route('/api/orders/' + f.order.id + '/wechat-receipt')).status, 404);
  assert.equal((await route('/api/orders/' + f.order.id + '/wechat-receipt', 'POST')).status, 404);
  const base = '/api/admin/integrations/wechat-orders';
  assert.equal((await route(base + '/status')).status, 401);
  assert.equal((await route(base + '/check', 'POST', 'product_admin')).status, 403);
  assert.equal((await route(base + '/orders/' + f.order.id + '/retry', 'POST', 'order_admin', { reason: 'test' })).status, 403);
  const status = await route(base + '/status', 'GET', 'super_admin');
  assert.equal(status.status, 200); assert.equal(JSON.stringify(status).includes('private-payer'), false);
  const queued = await route(base + '/orders/' + f.order.id + '/retry', 'POST', 'super_admin', { reason: '已核查' });
  assert.equal(queued.status, 202);
  assert.equal(f.state.adminOperationLogs[0].adminId, 'super_admin');
});
