function requestAuthorization(config) {
  if (!config?.enabled || !config.templateId || typeof wx.requestSubscribeMessage !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      wx.requestSubscribeMessage({ tmplIds: [config.templateId],
        success: result => resolve(result[config.templateId] === 'accept' ? { templateId: config.templateId, accepted: true } : null),
        fail: () => resolve(null)
      });
    } catch { resolve(null); }
  });
}
const labels = { queued: '已订阅，发货或到站后提醒', sent: '发货通知已发送', not_subscribed: '可订阅发货或到站提醒',
  not_configured: '发货通知暂未开放，请在订单页查看进度', failed: '发货通知未发送，请在订单页查看进度',
  uncertain: '通知发送结果待确认，请在订单页查看进度', stopped: '发货通知已停止' };
function label(notification) { return notification && notification.status !== 'not_required' ? labels[notification.status] || '' : ''; }
module.exports = { requestAuthorization, label };
