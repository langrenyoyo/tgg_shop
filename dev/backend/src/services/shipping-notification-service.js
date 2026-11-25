const { getState, saveState } = require('../data/store');
const { createOrderClient } = require('../integrations/wechat/order-client');
const { fulfilled } = require('../domain/wechat-orders');

const sources = {
  orderNo: ['character_string'], productName: ['thing'], shippingTime: ['time'],
  status: ['phrase', 'thing'], deliveryMethod: ['phrase', 'thing'], pickupSite: ['thing']
};
const terminal = order => !order || ['cancelled', 'closed', 'refunded'].includes(order.status);
const purePoints = order => order?.paymentMode === 'pure_points' && Number(order.cashAmount) === 0;
function settings(state) {
  const value = state.config?.shippingNotificationSettings;
  return value ? { enabled: value.enabled === true, templateId: value.templateId || '', fields: value.fields || [] }
    : { enabled: false, templateId: '', fields: [] };
}
function configured(state, env = process.env) {
  const config = settings(state);
  return config.enabled && !!config.templateId && config.fields.length > 0 && !!env.WECHAT_APPID && !!env.WECHAT_APPSECRET;
}
function jobs(state) { state.config ||= {}; return state.config.shippingNotificationJobs ||= {}; }
function publicConfig(state, env = process.env) {
  return { enabled: configured(state, env), templateId: configured(state, env) ? settings(state).templateId : '' };
}
function summary(state, order, env = process.env) {
  if (terminal(order)) return { status: 'stopped', canSubscribe: false };
  if (!purePoints(order)) return { status: 'not_required', canSubscribe: false };
  const job = state.config?.shippingNotificationJobs?.[order.id];
  const config = publicConfig(state, env);
  const status = job?.status === 'sending' ? 'uncertain' : job?.status || (config.enabled ? 'not_subscribed' : 'not_configured');
  return { ...config, status, canSubscribe: config.enabled && order.status === 'paid' && !job,
    sentAt: job?.sentAt || null, lastError: job?.lastError || null };
}
function adminStatus(state, env = process.env) {
  return { ...settings(state), configured: configured(state, env),
    counts: Object.values(state.config?.shippingNotificationJobs || {}).reduce((counts, job) => {
      const status = job.status === 'sending' ? 'uncertain' : job.status;
      counts[status] = (counts[status] || 0) + 1; return counts;
    }, {}) };
}
async function configure(state, input, actor, { save = saveState } = {}) {
  if (!input || typeof input.enabled !== 'boolean' || typeof input.templateId !== 'string' || !Array.isArray(input.fields)) return bad('请填写模板 ID 和字段映射');
  const templateId = input.templateId.trim(), fields = input.fields;
  if ((input.enabled || templateId) && !/^[A-Za-z0-9_-]{10,128}$/.test(templateId)) return bad('模板 ID 格式不正确，请从微信公众平台复制');
  if (fields.length > 5 || (input.enabled && fields.length < 1)) return bad('请按实际模板配置 1 至 5 个字段');
  const seen = new Set();
  for (const field of fields) {
    const match = typeof field?.key === 'string' && field.key.match(/^(character_string|thing|time|phrase)\d{1,2}$/);
    if (!match || !Object.hasOwn(sources, field.source) || !sources[field.source].includes(match[1]) || seen.has(field.key)) return bad('模板字段重复或类型不匹配，请核对字段名称和来源');
    seen.add(field.key);
  }
  const before = settings(state);
  state.config ||= {};
  state.config.shippingNotificationSettings = { enabled: input.enabled, templateId, fields: fields.map(({ key, source }) => ({ key, source })) };
  (state.adminOperationLogs ||= []).unshift({ id: 'shipping_config_' + require('node:crypto').randomUUID(), adminId: actor.adminId || actor.id,
    roleId: actor.role?.id, action: 'shipping_notification.configure', targetType: 'config', targetId: 'shippingNotifications',
    before, after: settings(state), createdAt: new Date().toISOString() });
  await save(); return { ok: true, settings: adminStatus(state) };
}
function bad(error, status = 400) { return { ok: false, status, error }; }
function register(state, userId, orderId, input, { env = process.env, now = Date.now } = {}) {
  const order = state.orders.find(row => row.id === orderId && row.userId === userId);
  if (!order) return bad('订单不存在', 404);
  const existing = state.config?.shippingNotificationJobs?.[order.id];
  if (existing) return { ok: true, notification: summary(state, order, env), idempotent: true };
  if (!summary(state, order, env).canSubscribe) return bad('当前订单不可订阅发货通知', 409);
  const config = settings(state), user = state.users.find(row => row.id === userId);
  if (input?.accepted !== true || input.templateId !== config.templateId) return bad('请先授权接收当前发货通知模板');
  if (!user?.wechatOpenid || user.status === 'disabled') return bad('请使用微信登录后订阅');
  // Snapshot the template and payer privately. A later config/account change
  // must never send a granted notification to a different recipient/template.
  jobs(state)[order.id] = { orderId: order.id, userId, openId: user.wechatOpenid, appId: env.WECHAT_APPID,
    templateId: config.templateId, fields: structuredClone(config.fields), status: 'queued',
    subscribedAt: new Date(now()).toISOString(), lastError: null };
  return { ok: true, notification: summary(state, order, env) };
}
const limit = (value, length) => Array.from(String(value || '').replace(/[\r\n\t]/g, ' ')).slice(0, length).join('');
function payload(order, job, now) {
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
  const values = { orderNo: order.id, productName: (order.items || []).map(item => item.title || item.name || '商品').join('、') || '积分兑换商品',
    shippingTime: time, status: order.fulfillmentType === 'pickup' ? '待自提' : '已发货',
    deliveryMethod: order.fulfillmentType === 'pickup' ? '到店自提' : '送货上门', pickupSite: order.pickupSiteSnapshot?.name || '送货上门' };
  return { touser: job.openId, template_id: job.templateId, page: 'pages/order-detail/index?id=' + encodeURIComponent(order.id),
    data: Object.fromEntries(job.fields.map(field => {
      const type = field.key.match(/^([a-z_]+)\d/)[1];
      return [field.key, { value: limit(values[field.source], { character_string: 32, thing: 20, phrase: 5, time: 32 }[type]) }];
    })) };
}
function createWorker({ state = getState, save = saveState, client = createOrderClient(), env = process.env, now = Date.now } = {}) {
  let running = null, stopped = false;
  async function sweep() {
    if (stopped) return;
    const current = state(), queue = Object.values(current.config?.shippingNotificationJobs || {});
    let sent = 0;
    for (const job of queue) {
      if (stopped || sent >= 10) break;
      if (job.status !== 'queued') continue;
      const order = current.orders.find(row => row.id === job.orderId);
      const user = current.users.find(row => row.id === job.userId);
      if (terminal(order) || !purePoints(order) || user?.status === 'disabled' || user?.wechatOpenid !== job.openId) {
        job.status = 'stopped'; await save(); continue;
      }
      if (!configured(current, env) || !client.configured() || job.appId !== client.appId() || !fulfilled(order)) continue;
      const body = payload(order, job, now());
      // Durable intent before the network call. A crash/timeout has an unknown
      // result: never resend and consume another one-time subscription grant.
      job.status = 'sending'; job.attemptedAt = new Date(now()).toISOString(); await save();
      if (!fulfilled(order) || user.wechatOpenid !== job.openId || user.status === 'disabled' || !configured(current, env)) {
        job.status = terminal(order) || user.status === 'disabled' || user.wechatOpenid !== job.openId ? 'stopped' : 'queued'; await save(); continue;
      }
      sent++;
      try {
        await client.sendSubscription(body);
        job.status = 'sent'; job.sentAt = new Date(now()).toISOString(); job.lastError = null;
      } catch (error) {
        const explicit = /^-?\d+$/.test(String(error.code));
        job.status = explicit ? 'failed' : 'uncertain';
        job.lastError = { code: explicit ? String(error.code) : 'network', message: explicit
          ? Number(error.code) === 43101 ? '用户未授权或订阅次数已用完' : '发货通知发送失败，请核对微信模板及错误码'
          : '发货通知发送结果待核查，系统不会重复发送' };
      }
      await save();
    }
  }
  return { run() {
    if (!running) running = sweep().catch(error => { stopped = true; throw error; }).finally(() => { running = null; });
    return running;
  }, async stop() { stopped = true; if (running) await running; } };
}
module.exports = { publicConfig, summary, adminStatus, configure, register, createWorker, payload };
