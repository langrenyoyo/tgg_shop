const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup() {
  const storage = { tgg_user: { id: 'alice' }, tgg_token: 'token-a' }, requests = [], views = [];
  let handler = async (url, options) => !options ? { required: true, extraData: { transaction_id: 'real-transaction' } } : { confirmed: false };
  const context = { module: { exports: {} }, require: () => ({ request: async (url, options) => { requests.push({ url, options }); return handler(url, options); } }),
    wx: { getStorageSync: key => storage[key], openBusinessView: options => { views.push(options); options.success({ status: 'success' }); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../../wechat-miniprogram/utils/wechat-orders.js'), 'utf8'), context);
  return { api: context.module.exports, storage, requests, views, setHandler(fn) { handler = fn; }, wx: context.wx };
}
test('native success is followed by server verification and never falls back to local receipt', async () => {
  const h = setup();
  const result = await h.api.confirmReceipt('order/one');
  assert.equal(h.views.length, 1); assert.equal(h.views[0].businessType, 'weappOrderConfirm');
  assert.equal(h.views[0].extraData.transaction_id, 'real-transaction');
  assert.equal(result.confirmed, false);
  assert.equal(h.requests.every(r => r.url.endsWith('/wechat-receipt')), true);
  assert.equal(h.requests[0].url, '/api/orders/order%2Fone/wechat-receipt');
  assert.equal(h.requests.filter(r => r.options?.method === 'POST').length, 2);
  h.setHandler(async () => ({ confirmed: true }));
  await h.api.reconcilePending();
  const count = h.requests.length; await h.api.reconcilePending(); assert.equal(h.requests.length, count);
});
test('account/session changes during API waits cannot invoke the native component or recover another account order', async () => {
  const h = setup();
  h.setHandler(async () => { h.storage.tgg_user = { id: 'bob' }; return { required: true, extraData: { transaction_id: 'alice-transaction' } }; });
  await assert.rejects(h.api.confirmReceipt('alice-order'), /登录状态已变化/);
  assert.equal(h.views.length, 0); assert.equal(h.requests.length, 1);
  const a = setup(); await a.api.confirmReceipt('alice-order');
  const count = a.requests.length; a.storage.tgg_token = 'new-token';
  await a.api.reconcilePending(); assert.equal(a.requests.length, count);
});
test('pure-points orders keep existing receipt and an already confirmed WeChat order does not reopen the component', async () => {
  const h = setup(); h.setHandler(async (url, options) => options ? {} : { required: false });
  await h.api.confirmReceipt('points-order');
  assert.equal(h.views.length, 0); assert.equal(h.requests[1].url, '/api/orders/points-order/receive');
  const a = setup(); a.setHandler(async (url, options) => options ? { confirmed: true } : { required: true });
  await a.api.confirmReceipt('wechat-order'); assert.equal(a.views.length, 0);
});
test('unsupported WeChat versions show an upgrade prompt and never directly complete an order', async () => {
  const h = setup(); delete h.wx.openBusinessView;
  await assert.rejects(h.api.confirmReceipt('wechat-order'), /升级微信/);
  assert.equal(h.requests.some(r => r.url.endsWith('/receive')), false);
});
