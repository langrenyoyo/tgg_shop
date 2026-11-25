process.env.TGG_STORE_MODE = 'memory';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createSeed } = require('../../src/data/seed');
const { createOrder } = require('../../src/domain/rules');
const service = require('../../src/services/shipping-notification-service');
const { createOrderClient } = require('../../src/integrations/wechat/order-client');
const paymentOrders = require('../../src/domain/wechat-orders');
const { activeConfig } = require('../../src/config/active-config');
const { handleWechatOrderRoutes } = require('../../src/routes/wechat-order-routes');
const { issueToken } = require('../../src/domain/auth');
const env = { WECHAT_APPID: 'wx-shipping-test', WECHAT_APPSECRET: 'private-secret' };
const config = { enabled: true, templateId: 'template_shipping_test', fields: [
  { key: 'character_string1', source: 'orderNo' }, { key: 'thing2', source: 'productName' },
  { key: 'time3', source: 'shippingTime' }, { key: 'phrase4', source: 'status' }
] };
function fixture(type = 'pickup') {
  const state = createSeed(), user = state.users[0]; user.wechatOpenid = 'private-openid';
  const result = createOrder(state, user.id, { paymentMode: 'pure_points', fulfillmentType: type,
    pickupSiteId: state.pickupSites.find(s => s.enabled).id, deliveryAddress: '测试地址',
    items: [{ productId: 'p_banana', quantity: 1 }] });
  assert.equal(result.ok, true); state.config.shippingNotificationSettings = structuredClone(config);
  return { state, user, order: result.order };
}
function register(f, input = { accepted: true, templateId: config.templateId }) {
  return service.register(f.state, f.user.id, f.order.id, input, { env });
}
function harness(f, options = {}) {
  const requests = []; let saves = 0;
  const client = { configured: () => true, appId: () => env.WECHAT_APPID,
    sendSubscription: async body => { requests.push(body); }, ...options.client };
  const save = options.save || (async () => { saves++; });
  const worker = service.createWorker({ state: () => f.state, save, env, client, now: () => Date.parse('2026-11-25T07:30:00Z') });
  return { worker, requests, client, save, saves: () => saves };
}
test('only owned paid pure-points orders with accepted current template and WeChat login can subscribe', () => {
  const f = fixture();
  assert.equal(service.register(f.state, 'other', f.order.id, {}, { env }).status, 404);
  assert.equal(register(f, { accepted: false, templateId: config.templateId }).status, 400);
  assert.equal(register(f, { accepted: true, templateId: 'stale' }).status, 400);
  delete f.user.wechatOpenid; assert.equal(register(f).status, 400); f.user.wechatOpenid = 'private-openid';
  for (const status of ['pending_payment', 'refunding', 'refunded', 'cancelled', 'closed', 'completed']) {
    f.order.status = status; assert.equal(register(f).status, 409, status);
  }
  f.order.status = 'paid'; f.order.cashAmount = 1; assert.equal(register(f).status, 409);
  f.order.cashAmount = 0; f.order.paymentMode = 'cash'; assert.equal(register(f).status, 409);
  f.order.paymentMode = 'pure_points'; assert.equal(register(f).ok, true);
  assert.equal(register(f).idempotent, true);
  assert.equal(Object.keys(f.state.config.shippingNotificationJobs).length, 1);
  assert.equal(JSON.stringify(service.summary(f.state, f.order, env)).includes('private-openid'), false);
  assert.equal(JSON.stringify(activeConfig(f.state.config)).includes('private-openid'), false);
});
test('pickup waits for station receipt and sends one snapshot-based reminder across concurrent runs and restarts', async () => {
  const f = fixture(); register(f); const h = harness(f);
  const financial = JSON.stringify({ payments: f.state.paymentLedger, points: f.state.pointLedger, users: f.state.users, products: f.state.products });
  await h.worker.run(); assert.equal(h.requests.length, 0);
  f.state.config.shippingNotificationSettings.templateId = 'changed_template';
  f.order.stationStatus = 'ready';
  await Promise.all([h.worker.run(), h.worker.run()]); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].template_id, config.templateId);
  assert.equal(h.requests[0].touser, 'private-openid');
  assert.equal(h.requests[0].data.phrase4.value, '待自提');
  assert.equal(h.requests[0].data.time3.value, '2026-11-25 15:30');
  assert.equal(h.requests[0].data.character_string1.value, f.order.id);
  assert.match(h.requests[0].page, /^pages\/order-detail\/index\?id=/);
  const restarted = service.createWorker({ state: () => f.state, save: h.save, client: h.client, env });
  await restarted.run(); assert.equal(h.requests.length, 1);
  assert.equal(register(f).idempotent, true); await restarted.run(); assert.equal(h.requests.length, 1);
  assert.equal(service.summary(f.state, f.order, env).status, 'sent');
  assert.equal(JSON.stringify({ payments: f.state.paymentLedger, points: f.state.pointLedger, users: f.state.users, products: f.state.products }), financial);
  assert.equal(paymentOrders.enqueue(f.state, f.order), null, 'pure points never masquerade as WeChat payment transactions');
});
test('delivery dispatch triggers a reminder; unsubscribed, cash and missing-template orders never send', async () => {
  const f = fixture('delivery'); register(f); const h = harness(f);
  await h.worker.run(); assert.equal(h.requests.length, 0);
  f.order.fulfillmentStatus = 'shipping'; await h.worker.run(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].data.phrase4.value, '已发货');
  const unsubscribed = fixture('delivery'); unsubscribed.order.fulfillmentStatus = 'shipping';
  const other = harness(unsubscribed); await other.worker.run(); assert.equal(other.requests.length, 0);
  delete unsubscribed.state.config.shippingNotificationSettings;
  assert.equal(service.publicConfig(unsubscribed.state, env).enabled, false);
  assert.equal(register(unsubscribed).status, 409);
});
test('refund, cancellation, recipient change and disabled user stop pending notifications; refunding only pauses', async () => {
  for (const change of ['refunded', 'cancelled', 'closed', 'recipient', 'disabled', 'refunding']) {
    const f = fixture(); register(f); f.order.stationStatus = 'ready';
    if (change === 'recipient') f.user.wechatOpenid = 'different-openid';
    else if (change === 'disabled') f.user.status = 'disabled'; else f.order.status = change;
    const h = harness(f); await h.worker.run(); assert.equal(h.requests.length, 0, change);
    assert.equal(f.state.config.shippingNotificationJobs[f.order.id].status, change === 'refunding' ? 'queued' : 'stopped');
  }
});
test('storage failures pause delivery and unknown send results are never resent, including after restart', async () => {
  for (const stage of ['sending', 'sent']) {
    const f = fixture(); register(f); f.order.stationStatus = 'ready';
    let fail = true;
    const h = harness(f, { save: async () => { if (fail && f.state.config.shippingNotificationJobs[f.order.id].status === stage) throw Error('disk failed'); } });
    await assert.rejects(h.worker.run(), /disk failed/);
    assert.equal(h.requests.length, stage === 'sending' ? 0 : 1);
    fail = false; await h.worker.run(); assert.equal(h.requests.length, stage === 'sending' ? 0 : 1);
    const restarted = service.createWorker({ state: () => f.state, save: h.save, client: h.client, env });
    await restarted.run(); assert.equal(h.requests.length, stage === 'sending' ? 0 : 1);
  }
  const f = fixture(); register(f); f.order.stationStatus = 'ready'; let calls = 0;
  const h = harness(f, { client: { sendSubscription: async () => { calls++; throw Error('private-token'); } } });
  await h.worker.run(); await h.worker.run(); assert.equal(calls, 1);
  assert.equal(service.summary(f.state, f.order, env).status, 'uncertain');
  assert.equal(JSON.stringify(service.summary(f.state, f.order, env)).includes('private-token'), false);
});
test('refund arriving during durable intent prevents send; provider permission errors remain visible without retry', async () => {
  const f = fixture(); register(f); f.order.stationStatus = 'ready';
  const h = harness(f, { save: async () => { if (f.state.config.shippingNotificationJobs[f.order.id].status === 'sending') f.order.status = 'refunded'; } });
  await h.worker.run(); assert.equal(h.requests.length, 0); assert.equal(service.summary(f.state, f.order, env).status, 'stopped');
  const denied = fixture(); register(denied); denied.order.stationStatus = 'ready'; let sends = 0;
  const d = harness(denied, { client: { sendSubscription: async () => { sends++; throw Object.assign(Error('private-recipient'), { code: '43101' }); } } });
  await d.worker.run(); await d.worker.run(); assert.equal(sends, 1);
  assert.equal(service.summary(denied.state, denied.order, env).lastError.code, '43101');
});
test('config validates exact template field types and duplicates and records an audit', async () => {
  const f = fixture(), options = { save: async () => {} };
  for (const fields of [[{ key: 'thing1', source: 'orderNo' }], [{ key: 'time1', source: '__proto__' }], [config.fields[0], config.fields[0]], [], [{ key: 'thing1', source: 'arbitraryUserInput' }]]) {
    const before = JSON.stringify(f.state);
    assert.equal((await service.configure(f.state, { ...config, fields }, { id: 'admin' }, options)).status, 400);
    assert.equal(JSON.stringify(f.state), before);
  }
  assert.equal((await service.configure(f.state, config, { id: 'admin' }, options)).ok, true);
  assert.equal(f.state.adminOperationLogs[0].action, 'shipping_notification.configure');
  f.order.items[0].title = '长商品名称'.repeat(20);
  register(f); const body = service.payload(f.order, f.state.config.shippingNotificationJobs[f.order.id], Date.now());
  assert.equal(Array.from(body.data.thing2.value).length, 20);
});
test('notification routes enforce ownership and integration permission; safe status excludes private jobs', async () => {
  const f = fixture(); register(f);
  async function route(url, role, userId = 'other') {
    const req = { method: 'POST', headers: {} };
    if (role) {
      const token = issueToken({ type: 'admin', roleId: role }), payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url'));
      f.state.authSessions.push({ subjectType: 'admin', subjectId: role, tokenId: payload.tokenId, expiresAt: new Date(payload.exp * 1000).toISOString() });
      req.headers.authorization = 'Bearer ' + token;
    }
    let response;
    await handleWechatOrderRoutes({ req, url: new URL('http://local' + url), state: f.state, user: { id: userId },
      res: {}, readBody: async () => config, send: (_, status, body) => { response = { status, body }; return true; } });
    return response;
  }
  assert.equal((await route('/api/orders/' + f.order.id + '/shipping-subscription')).status, 404);
  const endpoint = '/api/admin/integrations/wechat-orders/shipping-notifications';
  assert.equal((await route(endpoint)).status, 401);
  assert.equal((await route(endpoint, 'order_admin')).status, 403);
  assert.equal((await route(endpoint, 'super_admin')).status, 200);
  assert.equal(JSON.stringify(service.adminStatus(f.state, env)).includes('private-openid'), false);
});
test('subscription client requires an explicit successful acknowledgement, caches tokens and sanitizes provider errors', async () => {
  for (const ack of [{ errcode: 0 }, {}, { errcode: 43101, errmsg: 'private-openid-and-token' }]) {
    const urls = [], client = createOrderClient({ env, fetchImpl: async (url, options) => {
      urls.push(url);
      return { ok: true, json: async () => url.endsWith('stable_token') ? { access_token: 'private-token', expires_in: 7200 } : ack };
    } });
    if (ack.errcode === 0) { await client.sendSubscription({}); await client.sendSubscription({}); assert.equal(urls.filter(u => u.endsWith('stable_token')).length, 1); }
    else await assert.rejects(client.sendSubscription({}), error => error.code === (ack.errcode ? String(ack.errcode) : 'network') && !error.message.includes('private-openid'));
    assert.ok(urls.some(u => u.includes('/cgi-bin/message/subscribe/send?access_token=')));
  }
});
test('mini subscription helper requires explicit acceptance; rejection, unavailable API and errors do not block checkout', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../../wechat-miniprogram/utils/shipping-notifications.js'), 'utf8');
  for (const result of ['accept', 'reject', 'ban', 'error', 'unsupported', 'throw']) {
    const module = { exports: {} }, wx = result === 'unsupported' ? {} : { requestSubscribeMessage: options => {
      assert.equal(options.tmplIds[0], config.templateId);
      if (result === 'throw') throw Error('unsupported native API');
      if (result === 'error') options.fail({}); else options.success({ [config.templateId]: result });
    } };
    vm.runInNewContext(source, { module, wx });
    const grant = await module.exports.requestAuthorization({ enabled: true, templateId: config.templateId });
    assert.equal(grant?.accepted === true, result === 'accept');
    assert.equal(await module.exports.requestAuthorization({ enabled: false }), null);
  }
});

test('real HTTP order routes persist the grant with the points purchase and replay without additional balance changes', async t => {
  const { resetState } = require('../../src/data/store'), { routeApi } = require('../../src/routes/api-router');
  const state = resetState(), user = state.users[0]; user.wechatOpenid = 'private-openid';
  state.config.shippingNotificationSettings = structuredClone(config);
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const auth = require('../../src/services/auth-service');
  const token = auth.login(state, { userId: user.id, password: '123456' }).token;
  let sequence = 0;
  async function api(url, data, bearer = token) {
    let response;
    const req = { method: data ? 'POST' : 'GET', headers: bearer ? { authorization: 'Bearer ' + bearer } : {}, socket: { remoteAddress: 'shipping-api-' + ++sequence },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(data)); } };
    await routeApi(req, { writeHead(status) { response = { status }; }, end(value) { response.body = JSON.parse(value); } }, new URL('http://local' + url));
    return response;
  }
  assert.equal((await api('/api/shipping-notifications/config', null, '')).status, 401);
  assert.equal((await api('/api/shipping-notifications/config')).body.templateId, config.templateId);
  const body = { idempotencyKey: 'subscription-order-route', paymentMode: 'pure_points', fulfillmentType: 'pickup',
    pickupSiteId: state.pickupSites.find(s => s.enabled).id, items: [{ productId: 'p_banana', quantity: 1 }],
    shippingSubscription: { templateId: config.templateId, accepted: true, openId: 'attacker-supplied' } };
  const first = await api('/api/orders', body); assert.equal(first.status, 201);
  const orderId = first.body.id, before = JSON.stringify({ points: user.points, products: state.products, ledger: state.pointLedger });
  const second = await api('/api/orders', body); assert.equal(second.body.id, orderId);
  assert.equal(JSON.stringify({ points: user.points, products: state.products, ledger: state.pointLedger }), before);
  assert.equal(state.config.shippingNotificationJobs[orderId].openId, user.wechatOpenid);
  const detail = await api('/api/orders/' + orderId);
  assert.equal(detail.body.shippingNotification.status, 'queued');
  assert.equal(JSON.stringify(detail.body).includes('private-openid'), false);
  const otherToken = auth.login(state, { userId: state.users[1].id, password: '123456' }).token;
  assert.equal((await api('/api/orders/' + orderId + '/shipping-subscription', body.shippingSubscription, otherToken)).status, 404);
});

test('checkout acceptance is attached once; denial still submits and switching accounts while authorizing cannot purchase', async () => {
  const root = path.resolve(__dirname, '../../../../wechat-miniprogram');
  for (const scenario of ['accept', 'reject', 'switch']) {
    let page, authorize; const writes = [], attempts = [], storage = { tgg_user: { id: 'alice' } };
    const wx = { getStorageSync: key => storage[key], showToast() {}, redirectTo() {}, requestSubscribeMessage: options => { authorize = options; } };
    const module = { exports: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/shipping-notifications.js'), 'utf8'), { wx, module });
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/checkout/index.js'), 'utf8'), {
      wx, Page: value => { page = value; }, require: name => name.endsWith('shipping-notifications') ? module.exports : name.endsWith('cart') ? {
        checkoutIdempotencyKey: () => 'key', writeCheckoutAttempt: (_, value) => attempts.push(value), completeCheckout() {}
      } : { request: async (_, options) => { writes.push(options.data); return { id: 'created-order' }; } }
    });
    page.setData = (values, callback) => { Object.assign(page.data, values); callback?.(); };
    page.ownerId = 'alice'; page.idempotencyKey = 'key';
    Object.assign(page.data, { loading: false, modes: [{ id: 'pure_points' }], items: [{ productId: 'p_banana', quantity: 1 }], sites: [{ id: 'site1' }], deliveryAddress: '',
      config: { pickupEnabled: true, shippingNotification: { enabled: true, templateId: config.templateId } } });
    const submission = page.submit(); assert.ok(authorize); assert.equal(writes.length, 0);
    if (scenario === 'switch') storage.tgg_user = { id: 'bob' };
    authorize.success({ [config.templateId]: scenario === 'reject' ? 'reject' : 'accept' });
    await submission;
    assert.equal(writes.length, scenario === 'switch' ? 0 : 1);
    if (writes.length) assert.equal(writes[0].shippingSubscription?.accepted === true, scenario === 'accept');
    else assert.equal(attempts.length, 0);
    assert.equal(page.data.busy, false);
  }
});

test('legacy refunded orders render only refunded/stopped with no fulfillment actions even when the old sync is stale', () => {
  const dir = path.resolve(__dirname, '../../../frontend/admin/js');
  const context = vm.createContext({});
  for (const file of ['wechat-orders.js', 'render.js']) vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);
  vm.runInContext("currentAdminState = { identity: { permissions: ['*'] } }", context);
  const order = { id: 'refunded-legacy', status: 'refunded', fulfillmentType: 'pickup', fulfillmentStatus: 'pending_pickup', stationStatus: 'ready', items: [], wechatOrderSync: { status: 'awaiting_fulfillment' } };
  context.testOrder = order;
  const html = vm.runInContext('ordersRows([testOrder])', context);
  assert.match(html, /已退款/); assert.match(html, /已停止/); assert.match(html, /暂无操作/);
  assert.doesNotMatch(html, /待自提|已到站|待实际发货|核销自提|data-order-ship|data-print-order-id/);
  context.testOrder = { ...order, status: 'paid' };
  assert.match(vm.runInContext('ordersRows([testOrder])', context), /核销自提/);
});
