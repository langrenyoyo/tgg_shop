// Order management uses the mini-program access token, independently of the
// payment gateway and its signing credentials. Never reuse withdrawal mchids.
function createOrderClient({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cached = null, pending = null;
  const configured = () => Boolean(env.WECHAT_APPID && env.WECHAT_APPSECRET);
  async function request(path, body, token) {
    let response, result;
    try {
      response = await fetchImpl('https://api.weixin.qq.com/' + path + (token ? '?access_token=' + encodeURIComponent(token) : ''), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
      });
      result = await response.json();
    } catch { throw failure('network', '微信订单服务暂不可用，请稍后重试'); }
    if (!response.ok || !result || typeof result !== 'object') throw failure('network', '微信订单服务暂不可用，请稍后重试');
    if (result.errcode !== undefined && Number(result.errcode) !== 0) {
      // Provider error text can contain tokens, OpenIDs and request details.
      throw failure(String(Number(result.errcode)), '微信订单接口请求失败，请核查后台授权及错误码');
    }
    if ((path.startsWith('wxa/sec/order/') || path === 'cgi-bin/message/subscribe/send') && String(result.errcode) !== '0') throw failure('network', '微信接口未返回明确结果，请核查');
    return result;
  }
  async function token() {
    if (!configured()) throw failure('not_configured', '请配置小程序 AppID 和 AppSecret');
    if (cached && cached.expiresAt > now()) return cached.value;
    if (!pending) pending = request('cgi-bin/stable_token', {
      grant_type: 'client_credential', appid: env.WECHAT_APPID, secret: env.WECHAT_APPSECRET, force_refresh: false
    }).then(result => {
      if (!result.access_token || !Number.isFinite(Number(result.expires_in))) throw failure('token', '获取微信接口凭证失败');
      cached = { value: result.access_token, expiresAt: now() + Math.max(0, Number(result.expires_in) - 120) * 1000 };
      return cached.value;
    }).finally(() => { pending = null; });
    return pending;
  }
  async function callApi(path, body) {
    try { return await request(path, body, await token()); }
    catch (error) {
      if (!['40001', '40014', '42001'].includes(error.code)) throw error;
      cached = null;
      return request(path, body, await token());
    }
  }
  const call = (path, body) => callApi('wxa/sec/order/' + path, body);
  return {
    configured, appId: () => env.WECHAT_APPID || '',
    async managementStatus() {
      const body = { appid: env.WECHAT_APPID };
      const managed = await call('is_trade_managed', body);
      const confirmation = await call('is_trade_management_confirmation_completed', body);
      return { tradeManaged: managed.is_trade_managed === true, confirmationCompleted: confirmation.completed === true };
    },
    getOrder: transactionId => call('get_order', { transaction_id: transactionId }),
    uploadShipping: body => call('upload_shipping_info', body),
    sendSubscription: body => callApi('cgi-bin/message/subscribe/send', body)
  };
}
function failure(code, message) { return Object.assign(new Error(message), { code }); }
module.exports = { createOrderClient, failure };
