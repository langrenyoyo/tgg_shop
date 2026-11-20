const { request } = require('./api');
let pending = null;
function owner() { return wx.getStorageSync('tgg_user')?.id; }
function sameSession(userId, token) { return Boolean(userId && owner() === userId && wx.getStorageSync('tgg_token') === token); }
async function reconcilePending() {
  const task = pending;
  if (!task) return;
  if (!sameSession(task.userId, task.token)) { pending = null; return; }
  try {
    const result = await request('/api/orders/' + encodeURIComponent(task.orderId) + '/wechat-receipt', { method: 'POST', data: {} });
    if (result.confirmed && pending === task) pending = null;
    return result;
  } catch { /* Keep recovery possible when WeChat has not propagated receipt yet. */ }
}
async function confirmReceipt(orderId) {
  const userId = owner(), token = wx.getStorageSync('tgg_token');
  if (!userId || !token) throw new Error('请先登录');
  const path = '/api/orders/' + encodeURIComponent(orderId) + '/wechat-receipt';
  const info = await request(path);
  if (!sameSession(userId, token)) throw new Error('登录状态已变化，请重新进入订单');
  if (!info.required) return request('/api/orders/' + encodeURIComponent(orderId) + '/receive', { method: 'POST', data: {} });
  const checked = await request(path, { method: 'POST', data: {} });
  if (!sameSession(userId, token)) throw new Error('登录状态已变化，请重新进入订单');
  if (checked.confirmed) return checked;
  if (typeof wx.openBusinessView !== 'function') throw new Error('请升级微信后确认收货');
  pending = { orderId, userId, token };
  await new Promise((resolve, reject) => wx.openBusinessView({ businessType: 'weappOrderConfirm', extraData: info.extraData,
    success: resolve, fail: () => reject(new Error('微信确认收货未完成，请稍后重试')) }));
  // Native success only reports component navigation. Server query is the
  // authority, including onShow after returning from the confirmation view.
  return reconcilePending();
}
module.exports = { confirmReceipt, reconcilePending };
