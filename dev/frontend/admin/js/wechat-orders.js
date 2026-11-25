export function wechatOrdersPanel(state, { escapeHtml: esc, can }) {
  const status = state.wechatOrders;
  if (!status) return `<p class="note">${esc(state.wechatOrdersError || '微信订单管理状态暂不可用')}</p>`;
  const management = status.management;
  const details = !status.configured ? '请在服务器配置小程序 AppID 和 AppSecret。'
    : management?.lastError ? `${management.lastError.message}（${management.lastError.code}）`
    : !management ? '请检查微信后台开通及商户授权状态。'
    : !management.tradeManaged ? '当前小程序尚未开通微信发货信息管理服务。'
    : !management.confirmationCompleted ? '微信交易结算管理确认未完成，请在公众平台完成关联商户号的订单管理授权或解绑。'
    : '微信订单管理已开通，交易结算管理确认已完成。';
  return `<section class="note"><strong>微信订单管理：${status.enabled ? '已启用自动同步' : '自动同步未启用'}</strong><p>${esc(details)}</p>
    <p>自配送发货、商品到站可自提后上报。上传结果不明时先查单核对；微信确认收货由服务端查单确认。</p>
    ${can('integration:read') ? '<button class="action" data-wechat-order-check>检查微信授权状态</button>' : ''}
    ${state.wechatOrderMessage ? `<p role="status">${esc(state.wechatOrderMessage)}</p>` : ''}</section>${shippingPanel(status.shippingNotifications, { esc, can })}`;
}
function shippingPanel(config = {}, { esc, can }) {
  const sources = { orderNo: '订单号', productName: '商品名称', shippingTime: '通知发出时间', status: '发货/待自提状态', deliveryMethod: '配送方式', pickupSite: '自提点名称' };
  return `<section class="panel"><h2>纯积分订单发货通知</h2><p>${config.configured ? '已配置；用户授权后，配送发货或商品到站时发送一次提醒。' : '尚未启用。请先在微信公众平台添加发货通知订阅模板，再填写下方配置。'}</p>
    <p>发送成功 ${Number(config.counts?.sent || 0)} · 待发货 ${Number(config.counts?.queued || 0)} · 失败 ${Number(config.counts?.failed || 0)} · 结果待核查 ${Number(config.counts?.uncertain || 0)}</p>
    ${can('integration:write') ? `<form class="config-form" data-shipping-notification-form>
      <label><input type="checkbox" name="enabled" ${config.enabled ? 'checked' : ''}>启用积分订单发货通知</label>
      <label>模板 ID<input name="templateId" value="${esc(config.templateId || '')}" placeholder="从微信公众平台订阅消息复制" maxlength="128"></label>
      <p>按模板原样填写字段名，例如 character_string1、thing2、time3。订单号使用 character_string，商品/自提点使用 thing，时间使用 time，状态/配送方式使用 phrase 或 thing。留空行不会保存。</p>
      ${Array.from({ length: 5 }, (_, i) => { const field = config.fields?.[i] || {}; return `<label>模板字段 ${i + 1}<input name="fieldKey" value="${esc(field.key || '')}" placeholder="例如 thing2"><select name="fieldSource"><option value="">选择字段内容</option>${Object.entries(sources).map(([key, title]) => `<option value="${key}" ${field.source === key ? 'selected' : ''}>${title}</option>`).join('')}</select></label>`; }).join('')}
      <button class="action" type="submit">保存发货通知配置</button></form>` : ''}</section>`;
}
export function wechatOrderCell(order, { escapeHtml: esc, can, trustedHtml }) {
  if (['cancelled', 'closed', 'refunded'].includes(order.status)) return trustedHtml('已停止');
  const sync = order.wechatOrderSync;
  const labels = { not_required: '无需上报', awaiting_fulfillment: '待实际发货', pending: '待入队', queued: '待同步', sending: '同步中',
    synced: '已同步', retry: '待重试', blocked: '等待处理', uncertain: '结果待核查', skipped: '已停止' };
  if (!sync) return '-';
  if (order.paymentMode === 'pure_points') {
    const notification = order.shippingNotification;
    const messages = { not_configured: '通知未配置', not_subscribed: '用户未订阅', queued: '已订阅，待发货提醒', sent: '发货通知已发送', failed: '通知发送失败', uncertain: '通知结果待核查', stopped: '已停止' };
    return trustedHtml(`${esc(messages[notification?.status] || '用户未订阅')}${notification?.lastError ? `<small>${esc(notification.lastError.message)}（${esc(notification.lastError.code)}）</small>` : ''}`);
  }
  return trustedHtml(`${esc(sync.receiptConfirmedAt ? '微信已确认收货' : labels[sync.status] || sync.status)}
    ${sync.lastError ? `<small>${esc(sync.lastError.message)}（${esc(sync.lastError.code)}）</small>` : ''}
    ${sync.lastSyncedAt ? `<small>同步时间：${esc(new Date(sync.lastSyncedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))}</small>` : ''}
    ${can('integration:write') && ['retry', 'blocked', 'uncertain', 'pending'].includes(sync.status) ? `<button class="action" data-wechat-order-retry="${esc(order.id)}" data-uncertain="${sync.status === 'uncertain'}">核查后重试</button>` : ''}`);
}
export function wechatOrderSubmit(event, state, { api, render, reload }) {
  const form = event.target.closest('[data-shipping-notification-form]');
  if (!form) return false;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  if (button.disabled || !state.identity?.permissions?.some(p => p === '*' || p === 'integration:write')) return true;
  const values = new FormData(form), keys = values.getAll('fieldKey'), sources = values.getAll('fieldSource');
  const fields = keys.map((key, i) => ({ key: String(key).trim(), source: sources[i] })).filter(field => field.key || field.source);
  button.disabled = true;
  api('/api/admin/integrations/wechat-orders/shipping-notifications', { method: 'POST', body: JSON.stringify({ enabled: values.get('enabled') === 'on', templateId: String(values.get('templateId') || '').trim(), fields }) })
    .then(() => { state.wechatOrderMessage = '发货通知配置已保存。'; return reload(); })
    .catch(error => { state.wechatOrderMessage = error.message; render(state); })
    .finally(() => { button.disabled = false; });
  return true;
}
export function wechatOrderClick(event, state, { api, render, reload }) {
  const check = event.target.closest('[data-wechat-order-check]'), retry = event.target.closest('[data-wechat-order-retry]');
  if (!check && !retry) return false;
  const button = check || retry;
  const permission = check ? 'integration:read' : 'integration:write';
  if (button.disabled || !state.identity?.permissions?.some(p => p === '*' || p === permission)) return true;
  let reason = '', confirmUnshipped = false;
  if (retry) {
    reason = window.prompt('请填写核查及重试原因（已同步的订单不会重复上传）：');
    if (!reason?.trim()) return true;
    if (retry.dataset.uncertain === 'true') {
      confirmUnshipped = window.confirm('请先在微信公众平台核查此支付订单确实未发货。确认后系统会再次查单，仅未发货订单允许重试。是否已核查？');
      if (!confirmUnshipped) return true;
    }
  }
  button.disabled = true;
  const url = check ? '/api/admin/integrations/wechat-orders/check'
    : '/api/admin/integrations/wechat-orders/orders/' + encodeURIComponent(retry.dataset.wechatOrderRetry) + '/retry';
  api(url, { method: 'POST', body: JSON.stringify({ reason, confirmUnshipped }) })
    .then(() => { state.wechatOrderMessage = check ? '微信授权状态已刷新。' : '已加入核查及同步队列，请稍后刷新查看结果。'; return reload(); })
    .catch(error => { state.wechatOrderMessage = error.message; render(state); })
    .finally(() => { button.disabled = false; });
  return true;
}
