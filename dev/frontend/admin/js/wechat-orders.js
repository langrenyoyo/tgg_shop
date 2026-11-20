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
    ${state.wechatOrderMessage ? `<p role="status">${esc(state.wechatOrderMessage)}</p>` : ''}</section>`;
}
export function wechatOrderCell(order, { escapeHtml: esc, can, trustedHtml }) {
  const sync = order.wechatOrderSync;
  const labels = { not_required: '无需上报', awaiting_fulfillment: '待实际发货', pending: '待入队', queued: '待同步', sending: '同步中',
    synced: '已同步', retry: '待重试', blocked: '等待处理', uncertain: '结果待核查', skipped: '已停止' };
  if (!sync) return '-';
  return trustedHtml(`${esc(sync.receiptConfirmedAt ? '微信已确认收货' : labels[sync.status] || sync.status)}
    ${sync.lastError ? `<small>${esc(sync.lastError.message)}（${esc(sync.lastError.code)}）</small>` : ''}
    ${sync.lastSyncedAt ? `<small>同步时间：${esc(new Date(sync.lastSyncedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))}</small>` : ''}
    ${can('integration:write') && ['retry', 'blocked', 'uncertain', 'pending'].includes(sync.status) ? `<button class="action" data-wechat-order-retry="${esc(order.id)}" data-uncertain="${sync.status === 'uncertain'}">核查后重试</button>` : ''}`);
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
