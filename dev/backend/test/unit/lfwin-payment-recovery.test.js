process.env.TGG_STORE_MODE = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../../src/data/seed');
const payments = require('../../src/services/payment-service');
const goodsPayment = require('../helpers/goods-payment');
const { diagnostic } = require('../../src/services/lfwin-diagnostic');

function fixture() {
  const state = createSeed(), payment = goodsPayment(state);
  const input = { method: 'wechat_mini', appId: 'wx-original', openId: 'original-payer' };
  let creates = 0, queries = 0;
  const fields = { timeStamp: '1795229174', nonceStr: 'private-nonce', package: 'prepay_id=private-prepay', signType: 'RSA', paySign: 'private-signature' };
  const client = {
    createPayment: async () => { creates++; return { orderid: 'remote-1', ...fields }; },
    queryPayment: async () => { queries++; return { orderid: 'remote-1', mch_orderid: payment.payNo, paystatus: '0', paymoney: payment.amount }; }
  };
  return { state, payment, input, client, fields, creates: () => creates, queries: () => queries };
}

test('settlement configuration rejection persists only a fixed diagnostic and never retries creation blindly', async () => {
  const f = fixture(); let attempts = 0;
  f.client.createPayment = async () => {
    attempts++;
    const error = new Error('raw-secret');
    error.providerResponse = { status: '4000', message: ':-5039,微信小程序资金受控交易必须实时清算 raw-secret openid=private-id sign=private-key' };
    throw error;
  };
  const result = await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
  assert.equal(result.status, 502);
  assert.match(result.error, /实时清算.*-5039/);
  assert.equal(f.payment.status, 'pending');
  assert.equal(f.payment.metadata.lfwin.submissionState, 'unknown');
  const exception = f.state.exceptions.find(e => e.type === 'payment_initiation_uncertain');
  assert.equal(exception.payload.diagnostic.code, '-5039');
  assert.equal(exception.payload.diagnostic.category, 'settlement_configuration');
  for (const secret of ['raw-secret', 'private-id', 'private-key']) assert.equal(JSON.stringify([result, exception]).includes(secret), false);
  assert.match((await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client)).error, /-5039/);
  assert.equal(attempts, 1);
});

test('unrecognized provider text is excluded while known upstream missing order remains pending', async () => {
  const error = new Error('secret');
  error.providerResponse = { status: '4000', message: 'unexpected confidential request' };
  assert.equal(JSON.stringify(diagnostic(error)).includes('confidential'), false);
  const f = fixture();
  f.payment.metadata.lfwin = { providerOrderNo: 'remote-1', submissionState: 'submitted' };
  error.providerResponse.message = ':-4006,订单不存在 secret';
  f.client.queryPayment = async () => { throw error; };
  const result = await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
  assert.match(result.error, /-4006/);
  assert.equal(f.creates(), 0);
  assert.equal(f.payment.status, 'pending');
  assert.equal(f.state.orders.find(o => o.id === f.payment.orderId).status, 'pending_payment');
  await payments.queryLfwinPayment(f.state, f.payment.payNo, f.client);
  assert.equal(f.state.exceptions.filter(e => e.type === 'payment_query_failed').length, 1);
});

test('continue payment validates remote status and reuses original payer parameters without another prepay', async () => {
  const f = fixture();
  assert.equal((await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client)).ok, true);
  const second = await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.provider.requestPayment, f.fields);
  assert.equal(f.creates(), 1); assert.equal(f.queries(), 1);
  for (const secret of ['private-nonce', 'private-prepay', 'private-signature']) assert.equal(JSON.stringify(f.state).includes(secret), false);
  assert.equal(JSON.stringify(payments.listUserPayments(f.state, f.payment.userId)).includes('original-payer'), false);
});

test('changed payer, amount or provider order cannot recover cached native payment parameters', async () => {
  for (const change of ['payer', 'amount', 'order']) {
    const f = fixture();
    await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
    if (change === 'payer') f.input = { ...f.input, openId: 'different-payer' };
    if (change === 'amount') f.client.queryPayment = async () => ({ orderid: 'remote-1', paystatus: '0', paymoney: f.payment.amount + 1 });
    if (change === 'order') f.client.queryPayment = async () => ({ orderid: 'different-order', paystatus: '0', paymoney: f.payment.amount });
    const result = await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
    assert.equal(result.ok, false, change);
    assert.equal(result.provider, undefined);
    assert.equal(f.creates(), 1);
    assert.equal(f.state.config.wechatOrders.payments[f.payment.payNo].openId, 'original-payer');
  }
});

test('expired parameters and restart never cause duplicate prepay', async () => {
  const f = fixture();
  await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
  const restarted = structuredClone(f.state);
  assert.equal((await payments.initiateLfwinPayment(restarted, f.payment.payNo, f.input, f.client)).status, 409);
  const now = Date.now;
  try {
    const later = now() + 11 * 60 * 1000; Date.now = () => later;
    assert.equal((await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client)).status, 409);
  } finally { Date.now = now; }
  assert.equal(f.creates(), 1);
});

test('a paid query settles once and returns without native parameters or another prepay', async () => {
  const f = fixture();
  await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
  f.client.queryPayment = async () => ({ mch_orderid: f.payment.payNo, orderid: 'remote-1', paystatus: '1', paymoney: f.payment.amount });
  f.client.verifyNotification = () => true;
  const result = await payments.initiateLfwinPayment(f.state, f.payment.payNo, f.input, f.client);
  assert.equal(result.ok, true); assert.equal(result.payment.status, 'paid');
  assert.equal(result.provider.requestPayment, null);
  assert.equal(f.creates(), 1);
  assert.equal(f.state.orders.find(o => o.id === f.payment.orderId).status, 'paid');
});
