const admin = require('../services/admin-service');
const service = require('../services/wechat-order-service');
const notifications = require('../services/shipping-notification-service');
const { saveState } = require('../data/store');

async function handleWechatOrderRoutes(ctx) {
  const { req, url, state, user, send, readBody, res } = ctx;
  if (req.method === 'GET' && url.pathname === '/api/shipping-notifications/config') {
    return send(res, 200, notifications.publicConfig(state), { 'Cache-Control': 'no-store' });
  }
  const subscription = url.pathname.match(/^\/api\/orders\/([^/]+)\/shipping-subscription$/);
  if (req.method === 'POST' && subscription) {
    const result = notifications.register(state, user.id, subscription[1], await readBody(req));
    if (result.ok) await saveState();
    return send(res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error }, { 'Cache-Control': 'no-store' });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/integrations/wechat-orders/shipping-notifications') {
    const check = admin.requirePermission(req, state, 'integration:write');
    if (!check.ok) return send(res, check.status, { error: check.error });
    const result = await notifications.configure(state, await readBody(req), check);
    return send(res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }
  const receipt = url.pathname.match(/^\/api\/orders\/([^/]+)\/wechat-receipt$/);
  if (receipt && ['GET', 'POST'].includes(req.method)) {
    const result = req.method === 'GET' ? service.receiptInfo(state, user.id, receipt[1])
      : await service.reconcileReceipt(state, user.id, receipt[1]);
    return send(res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error }, { 'Cache-Control': 'no-store' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/integrations/wechat-orders/status') {
    const check = admin.requirePermission(req, state, 'order:read');
    if (!check.ok) return send(res, check.status, { error: check.error });
    return send(res, 200, service.status(state), { 'Cache-Control': 'no-store' });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/integrations/wechat-orders/check') {
    const check = admin.requirePermission(req, state, 'integration:read');
    if (!check.ok) return send(res, check.status, { error: check.error });
    await service.checkManagement(state);
    return send(res, 200, service.status(state), { 'Cache-Control': 'no-store' });
  }
  const retry = url.pathname.match(/^\/api\/admin\/integrations\/wechat-orders\/orders\/([^/]+)\/retry$/);
  if (req.method === 'POST' && retry) {
    const check = admin.requirePermission(req, state, 'integration:write');
    if (!check.ok) return send(res, check.status, { error: check.error });
    const result = await service.retry(state, retry[1], await readBody(req), check);
    return send(res, result.ok ? 202 : result.status, result.ok ? result : { error: result.error });
  }
  return false;
}
module.exports = { handleWechatOrderRoutes };
