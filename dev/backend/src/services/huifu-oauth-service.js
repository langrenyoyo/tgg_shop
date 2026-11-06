const { saveState } = require("../data/store");
const huifu = require("./withdrawal-provider/huifu-bafang");
const failure = (error, status = 502) => ({ ok: false, status, error });

// 4.13/4.14 share the same server-owned account used by Chapter 4.3 payouts.
async function getConfig(user, env = process.env, includeNavigation = false) {
  const schemeMode = huifu.oauthPath(env) === "/api/mp/getScheme";
  const account = huifu.oauthAccount(user);
  const merchantId = String(env.HF_MERCHANT_ID || "").trim();
  const appid = String(env.HF_WECHAT_APPID || env.WECHAT_APPID || "").trim();
  const openid = String(user?.wechatOpenid || user?.openid || "").trim();
  if (!account || !merchantId || !appid) return failure("微信账号或商户配置不完整", 503);
  let result;
  try { result = await huifu.oauthConfig({ account, merchant_id: merchantId, appid }, env); }
  catch { return failure("授权配置获取失败，请稍后刷新"); }
  if (!result.ok) {
    if (Number(result.body?.code) === 1001 && result.body?.message === "商户号没有开通该接口权限") return failure("商户尚未开通微信授权服务，请联系客服", 503);
    return failure("授权配置获取失败，请稍后刷新", result.configured === false ? 503 : 502);
  }
  const data = result.body?.data;
  const validState = data && (schemeMode
    ? /^\d+$/.test(String(data.is_auth)) && Number.isSafeInteger(Number(data.is_auth))
    : [0, 1, "0", "1"].includes(data.is_auth));
  if (!validState) return failure("服务商返回的授权状态无效");
  const active = Number(data.is_auth) > 0;
  const status = active ? "active" : "none";
  // Even an incomplete navigation response must revoke a formerly active account.
  user.huifuAuthorization = { mode: "OAUTH", status, account, merchantId, appid, openid, verifiedAt: new Date().toISOString() };
  await saveState();
  const response = { ok: true, required: true, status, method: schemeMode ? "urlScheme" : "miniProgram" };
  if (active || !includeNavigation) return response;
  if (schemeMode) {
    const scheme = String(data.scheme || "").trim();
    const expireTime = /^-?\d+$/.test(String(data.expire_time)) ? Number(data.expire_time) : NaN;
    // Only the documented encrypted WeChat scheme is allowed; preserve its ticket exactly.
    if (!/^weixin:\/\/dl\/business\/\?t=[a-zA-Z0-9_%+\-=]+$/.test(scheme) || scheme.length > 4096
      || !Number.isSafeInteger(expireTime) || expireTime < -1 || expireTime > 8640000000000) return failure("服务商返回的授权链接无效，请重新获取");
    if (expireTime !== -1 && expireTime * 1000 <= Date.now()) return failure("授权链接已失效，请重新获取", 409);
    return { ...response, scheme, expireTime };
  }
  const target = String(data.hf_appid || "").trim();
  const path = String(data.path || "").trim();
  const query = String(data.query || "").replace(/^\?/, "");
  if (!/^wx[a-zA-Z0-9]{16}$/.test(target) || !/^\/?[a-zA-Z0-9_/-]+$/.test(path)
    || path.includes("..") || !query || /[\r\n#]/.test(query) || path.length + query.length > 4096) {
    return failure("服务商返回的授权页面信息不完整，请稍后重试");
  }
  // Preserve the provider's encoded query verbatim; never expose the AES keys.
  return { ...response, appId: target, path: `${path.replace(/^\//, "")}?${query}` };
}
module.exports = { getConfig };
