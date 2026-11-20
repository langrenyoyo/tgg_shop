function enabled(env = process.env) { return env.WECHAT_ORDER_MANAGEMENT_ENABLED === '1'; }
function paymentFor(state, order) {
  return (state.paymentLedger || []).find(p => p.orderId === order.id && p.direction === 'in' && p.status === 'paid'
    && p.channel === 'lfwin_wechat_mini' && Number(p.amount) > 0);
}
function requiresReceipt(state, order, env = process.env) { return enabled(env) && Boolean(paymentFor(state, order)); }
function fulfilled(order) {
  if (!['paid', 'completed'].includes(order.status)) return false;
  if (order.fulfillmentType === 'delivery') return ['shipping', 'delivered'].includes(order.fulfillmentStatus);
  return order.fulfillmentType === 'pickup' && (order.fulfillmentStatus === 'picked_up'
    || (order.fulfillmentStatus === 'pending_pickup' && ['ready', 'received'].includes(order.stationStatus)));
}
function data(state) {
  state.config ||= {};
  const store = state.config.wechatOrders ||= {};
  store.jobs ||= {};
  store.payments ||= {};
  return store;
}
function enqueue(state, order, now = Date.now()) {
  const payment = paymentFor(state, order);
  if (!payment || !fulfilled(order)) return null;
  const store = data(state);
  store.jobs ||= {};
  if (store.jobs[order.id]) return store.jobs[order.id];
  const stamp = new Date(now).toISOString();
  return store.jobs[order.id] = { orderId: order.id, payNo: payment.payNo, status: 'queued', attempts: 0,
    createdAt: stamp, updatedAt: stamp, nextAttemptAt: null, lastError: null };
}
function capturePaymentIdentity(state, payment, payload, env = process.env) {
  // trade_no is LFWin's upstream payment transaction number. Its platform
  // orderid is deliberately never substituted for a WeChat transaction_id.
  const transactionId = typeof payload.trade_no === 'string' && /^\d{20,64}$/.test(payload.trade_no) ? payload.trade_no : null;
  const previous = state.config?.wechatOrders?.payments?.[payment.payNo];
  if (previous?.transactionId && transactionId && previous.transactionId !== transactionId) return false;
  if (!transactionId || payment.channel !== 'lfwin_wechat_mini') return true;
  const user = (state.users || []).find(u => u.id === payment.userId);
  data(state).payments[payment.payNo] = { ...previous, transactionId,
    appId: previous?.appId || env.WECHAT_APPID || '',
    openId: previous?.openId || user?.wechatOpenid || '' };
  return true;
}
function summary(state, order) {
  const job = state.config?.wechatOrders?.jobs?.[order.id];
  if (!paymentFor(state, order)) return { status: 'not_required' };
  if (!job) return { status: fulfilled(order) ? 'pending' : 'awaiting_fulfillment' };
  return { status: job.status, attempts: job.attempts, lastSyncedAt: job.lastSyncedAt || null,
    nextAttemptAt: job.nextAttemptAt || null, lastError: job.lastError ? { code: job.lastError.code, message: job.lastError.message, at: job.lastError.at } : null,
    receiptConfirmedAt: job.receiptConfirmedAt || null, remoteOrderState: job.remoteOrderState || null };
}
function captureRequestIdentity(state, payment, input) {
  if (input.method !== 'wechat_mini' || !input.appId || !input.openId) return;
  const store = data(state), previous = store.payments[payment.payNo];
  // Snapshot the payer while it is known; do not put OpenIDs in payment
  // metadata, which existing user and finance endpoints serialize.
  store.payments[payment.payNo] = { ...previous, appId: input.appId, openId: input.openId };
}
module.exports = { enabled, paymentFor, requiresReceipt, fulfilled, data, enqueue, capturePaymentIdentity, captureRequestIdentity, summary };
