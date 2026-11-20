const { getState, saveState } = require('../data/store');
const model = require('../domain/wechat-orders');
const { createOrderClient, failure } = require('../integrations/wechat/order-client');
const { confirmDeliveryOrder } = require('../domain/fulfillment-rules');
const { exclusive } = require('./operation-lock');

const messages = {
  not_configured: '小程序 AppID 或 AppSecret 未配置', authorization: '请在微信公众平台完成订单管理及关联商户号授权',
  identity_missing: '缺少已核验的微信支付交易号或支付用户信息，请先核查 LFWin 查单结果',
  identity_conflict: '微信支付单身份或金额与本地记录不一致，请人工核查',
  shipping_conflict: '微信已有不同的发货信息，请在微信后台核查，系统不会覆盖',
  uncertain: '上次发货上传结果待核查，系统仅查单，不自动重复发货',
  network: '微信订单服务暂不可用，请稍后重试'
};
function safeError(error, now) {
  const code = (messages[error.code] || /^-?\d+$/.test(String(error.code))) ? String(error.code) : 'provider_error';
  return { code, message: messages[code] || '微信订单接口失败，请核查授权、错误码及网络', at: new Date(now).toISOString() };
}
function identity(state, order, appId) {
  const payment = model.paymentFor(state, order), info = state.config?.wechatOrders?.payments?.[payment?.payNo];
  if (!payment || !info?.transactionId || !info.openId || !info.appId) throw failure('identity_missing');
  if (info.appId !== appId) throw failure('identity_conflict');
  return { payment, info };
}
function validateRemote(remote, payment, info) {
  const order = remote?.order;
  if (!order || order.transaction_id !== info.transactionId || order.openid !== info.openId
    || !Number.isSafeInteger(order.paid_amount) || order.paid_amount !== Math.round(Number(payment.amount) * 100)
    || ![1, 2, 3, 4, 5, 6].includes(order.order_state)) throw failure('identity_conflict');
  return order;
}
function logistics(order) { return order.fulfillmentType === 'pickup' ? 4 : 2; }
function remoteShipped(remote, order) {
  if (remote.order_state === 5) return false;
  const shipped = remote.shipping?.finish_shipping === true || [2, 3, 4, 6].includes(remote.order_state);
  if (shipped && (remote.shipping?.logistics_type !== logistics(order) || remote.shipping?.delivery_mode !== 1)) throw failure('shipping_conflict');
  return shipped;
}
function recordReceipt(state, order, job, remote, now) {
  job.remoteOrderState = remote.order_state;
  job.lastCheckedAt = new Date(now).toISOString();
  if (![3, 4].includes(remote.order_state)) return false;
  const physicallyReceived = order.fulfillmentType === 'pickup' ? order.fulfillmentStatus === 'picked_up' : order.fulfillmentStatus === 'delivered';
  if (!physicallyReceived) return false;
  // Platform receipt never changes payment/points/refund ledgers and never
  // treats an item still being delivered as physically delivered.
  if (order.fulfillmentType === 'delivery' && order.fulfillmentStatus === 'delivered' && order.status === 'paid') {
    confirmDeliveryOrder(state, order.id, { operatorType: 'system', operatorId: 'wechat', reason: '微信查单确认用户已收货' });
  }
  job.receiptConfirmedAt ||= new Date(now).toISOString();
  return true;
}
function shippingPayload(order, info, uploadTime) {
  const description = Array.from((order.items || []).map(item => `${item.title || item.name || '商品'}×${item.quantity}`).join('；')).slice(0, 120).join('');
  if (!description) throw failure('identity_missing');
  return { order_key: { order_number_type: 2, transaction_id: info.transactionId }, logistics_type: logistics(order),
    delivery_mode: 1, shipping_list: [{ item_desc: description }], upload_time: uploadTime, payer: { openid: info.openId } };
}
async function checkManagement(state, client = createOrderClient(), { save = saveState, now = Date.now } = {}) {
  const store = model.data(state);
  try {
    store.management = { ...await client.managementStatus(), checkedAt: new Date(now()).toISOString(), lastError: null };
  } catch (error) { store.management = { checkedAt: new Date(now()).toISOString(), lastError: safeError(error, now()) }; }
  await save();
  return store.management;
}
function status(state, env = process.env) {
  const jobs = Object.values(state.config?.wechatOrders?.jobs || {});
  return { enabled: model.enabled(env), configured: Boolean(env.WECHAT_APPID && env.WECHAT_APPSECRET), appId: env.WECHAT_APPID || '',
    management: state.config?.wechatOrders?.management || null,
    counts: jobs.reduce((counts, job) => { counts[job.status] = (counts[job.status] || 0) + 1; return counts; }, {}) };
}
function createWorker({ state = getState, save = saveState, client = createOrderClient(), now = Date.now,
  enabled = () => model.enabled() } = {}) {
  let running = null, stopped = false;
  async function sweep() {
    if (stopped || !enabled()) return;
    const current = state(), store = model.data(current);
    let added = false;
    for (const order of current.orders || []) {
      const payment = model.paymentFor(current, order);
      if (payment && !store.payments[payment.payNo]?.transactionId && payment.thirdTradeNo !== payment.metadata?.lfwin?.providerOrderNo) {
        model.capturePaymentIdentity(current, payment, { trade_no: payment.thirdTradeNo });
        if (store.payments[payment.payNo]?.transactionId) added = true;
      }
      if (!store.jobs?.[order.id] && model.enqueue(current, order, now())) added = true;
    }
    if (added) await save();
    const jobs = Object.values(store.jobs || {}).filter(job => job.status !== 'skipped'
      && (!job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now()))
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).slice(0, 10);
    if (!jobs.length) return;
    if (!store.management?.checkedAt || now() - Date.parse(store.management.checkedAt) > 300000) await checkManagement(current, client, { save, now });
    for (const job of jobs) {
      if (stopped) break;
      await exclusive(job, async () => {
        let storageFailure;
        const durableSave = async () => { try { await save(); } catch (error) { storageFailure = error; throw error; } };
        const order = current.orders.find(row => row.id === job.orderId);
        if (!order || ['cancelled', 'closed', 'refunded'].includes(order.status)) {
          job.status = 'skipped'; job.lastError = null; job.updatedAt = new Date(now()).toISOString(); await save(); return;
        }
        if (!model.fulfilled(order)) { job.nextAttemptAt = new Date(now() + 300000).toISOString(); await save(); return; }
        job.attempts++; job.updatedAt = new Date(now()).toISOString();
        await save();
        try {
          if (!store.management?.tradeManaged || !store.management?.confirmationCompleted || store.management.lastError) throw failure('authorization');
          const { payment, info } = identity(current, order, client.appId());
          const remote = validateRemote(await client.getOrder(info.transactionId), payment, info);
          if (!model.fulfilled(order)) { job.nextAttemptAt = new Date(now() + 300000).toISOString(); await durableSave(); return; }
          if (remote.order_state === 5) { job.status = 'skipped'; job.lastError = null; await durableSave(); return; }
          const shipped = remoteShipped(remote, order);
          recordReceipt(current, order, job, remote, now());
          if (!shipped) {
            // A crash or timeout after the durable sending intent must never
            // consume WeChat's single re-shipping allowance automatically.
            if (job.uploadAttempted) throw failure('uncertain');
            if (!model.fulfilled(order)) return;
            job.uploadTime ||= new Date(now()).toISOString();
            const payload = shippingPayload(order, info, job.uploadTime);
            job.uploadAttempted = true; job.status = 'sending';
            await durableSave();
            if (!model.fulfilled(order)) { job.uploadAttempted = false; job.status = 'queued'; await durableSave(); return; }
            try { await client.uploadShipping(payload); }
            catch (error) {
              // An explicit parameter/permission rejection is safe to retry.
              if (/^\d+$/.test(String(error.code)) && !['10060012', '10060019', '10060002', '10060003'].includes(error.code)) job.uploadAttempted = false;
              throw error;
            }
          }
          job.status = 'synced'; job.lastSyncedAt ||= new Date(now()).toISOString(); job.lastError = null;
          job.nextAttemptAt = job.receiptConfirmedAt ? new Date(now() + 86400000).toISOString() : new Date(now() + 300000).toISOString();
        } catch (error) {
          if (storageFailure) throw storageFailure;
          job.lastError = safeError(error, now());
          job.status = job.uploadAttempted ? 'uncertain' : ['identity_missing', 'identity_conflict', 'shipping_conflict', 'authorization'].includes(error.code) ? 'blocked' : 'retry';
          const delay = job.status === 'blocked' ? 300000 : Math.min(3600000, 30000 * 2 ** Math.min(job.attempts - 1, 7));
          job.nextAttemptAt = new Date(now() + delay).toISOString();
        }
        job.updatedAt = new Date(now()).toISOString();
        await save();
      });
    }
  }
  return { run() {
    if (!running) running = sweep().catch(error => { stopped = true; throw error; }).finally(() => { running = null; });
    return running;
  }, async stop() { stopped = true; if (running) await running; } };
}
function receiptInfo(state, userId, orderId, env = process.env) {
  const order = state.orders.find(row => row.id === orderId && row.userId === userId);
  if (!order) return { ok: false, status: 404, error: '订单不存在' };
  if (!model.requiresReceipt(state, order, env)) return { ok: true, required: false };
  const job = state.config?.wechatOrders?.jobs?.[order.id];
  const received = order.fulfillmentType === 'pickup' ? order.fulfillmentStatus === 'picked_up' : order.fulfillmentStatus === 'delivered';
  if (!received || !['paid', 'completed'].includes(order.status)) return { ok: false, status: 409, error: '请实际收到商品后再确认收货' };
  if (job?.status !== 'synced') return { ok: false, status: 409, error: '微信发货信息尚未同步，请稍后重试或联系商家' };
  try {
    const { info } = identity(state, order, env.WECHAT_APPID);
    return { ok: true, required: true, confirmed: Boolean(job.receiptConfirmedAt), businessType: 'weappOrderConfirm', extraData: { transaction_id: info.transactionId } };
  } catch { return { ok: false, status: 409, error: '微信交易信息待核查，请联系商家' }; }
}
async function reconcileReceipt(state, userId, orderId, { client = createOrderClient(), save = saveState, now = Date.now, env = process.env } = {}) {
  const detail = receiptInfo(state, userId, orderId, env);
  if (!detail.ok || !detail.required) return detail;
  const order = state.orders.find(row => row.id === orderId), job = model.data(state).jobs[orderId];
  return exclusive(job, async () => {
    let confirmed;
    try {
      const { payment, info } = identity(state, order, client.appId());
      const remote = validateRemote(await client.getOrder(info.transactionId), payment, info);
      if (!remoteShipped(remote, order)) throw failure('shipping_conflict');
      if (!model.fulfilled(order)) return { ok: false, status: 409, error: '订单状态已变化，请刷新后重试' };
      confirmed = recordReceipt(state, order, job, remote, now());
    } catch (error) { return { ok: false, status: 502, error: safeError(error, now()).message }; }
    await save();
    return { ok: true, required: true, confirmed, order };
  });
}
async function retry(state, orderId, input, actor, { save = saveState, client = createOrderClient(), now = Date.now } = {}) {
  const order = state.orders.find(row => row.id === orderId);
  if (!order) return { ok: false, status: 404, error: '订单不存在' };
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 200) return { ok: false, status: 400, error: '请填写核查及重试原因（200字以内）' };
  const job = model.enqueue(state, order, now());
  if (!job) return { ok: false, status: 409, error: '订单未完成真实微信付款或尚未进入发货阶段' };
  return exclusive(job, async () => {
    if (job.status === 'synced') return { ok: false, status: 409, error: '发货已同步，无需重复上传' };
    if (job.uploadAttempted) {
      if (input.confirmUnshipped !== true || now() - Date.parse(job.uploadTime) < 60000) return { ok: false, status: 409, error: '请先在微信后台核查未发货，并在上次上传一分钟后确认重试' };
      try {
        const { payment, info } = identity(state, order, client.appId());
        const remote = validateRemote(await client.getOrder(info.transactionId), payment, info);
        if (remoteShipped(remote, order) || remote.order_state !== 1) return { ok: false, status: 409, error: '微信订单已发货或状态不允许重试，请刷新核查' };
      } catch { return { ok: false, status: 502, error: '无法确认微信订单未发货，请稍后核查' }; }
      job.uploadAttempted = false;
      job.uploadTime = null;
    }
    job.status = 'queued'; job.lastError = null; job.nextAttemptAt = null; job.updatedAt = new Date(now()).toISOString();
    (state.adminOperationLogs ||= []).unshift({ id: 'wxorder_' + require('node:crypto').randomUUID(), adminId: actor.adminId || actor.id,
      roleId: actor.role?.id, action: 'wechat_order.retry', targetType: 'order', targetId: orderId,
      reason: String(input.reason).trim(), before: {}, after: { status: job.status }, createdAt: job.updatedAt });
    await save();
    return { ok: true, sync: model.summary(state, order) };
  });
}
module.exports = { createWorker, checkManagement, status, receiptInfo, reconcileReceipt, retry, shippingPayload };
