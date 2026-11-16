// Phone numbers come only from WeChat's one-time phone authorization code.
async function exchangePhoneCode(code, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof code !== "string" || !code.trim() || code.length > 512) throw new Error("请重新授权微信手机号");
  const appid = env.WECHAT_APPID, secret = env.WECHAT_APPSECRET;
  if (!appid || !secret) throw new Error("微信手机号服务未配置，请联系管理员");
  async function post(url, body) {
    const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || result.errcode) throw new Error("微信手机号授权失败，请重新授权后重试");
    return result;
  }
  try {
    const token = await post("https://api.weixin.qq.com/cgi-bin/stable_token", { grant_type: "client_credential", appid, secret });
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("invalid token");
    const result = await post("https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=" + encodeURIComponent(token.access_token), { code });
    const info = result.phone_info;
    if (!info || info.watermark?.appid !== appid || String(info.countryCode) !== "86" || !/^1\d{10}$/.test(info.purePhoneNumber)) {
      throw new Error("invalid phone response");
    }
    return info.purePhoneNumber;
  } catch { throw new Error("微信手机号授权失败，请重新授权后重试"); }
}
module.exports = { exchangePhoneCode };
