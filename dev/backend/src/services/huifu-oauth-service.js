const { saveState } = require("../data/store");
const huifu = require("./withdrawal-provider/huifu-bafang");
const failure = (error, status = 502) => ({ ok: false, status, error });

// 4.13 is account authorization for 4.3, not V3's authorization_no consent.
async function getConfig(user, env = process.env, includeNavigation = false) {
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
  if (!data || ![0, 1, "0", "1"].includes(data.is_auth)) return failure("服务商返回的授权状态无效");
  const active = Number(data.is_auth) === 1;
  const status = active ? "active" : "none";
  // Even an incomplete navigation response must revoke a formerly active account.
  user.huifuAuthorization = { mode: "OAUTH", status, account, merchantId, appid, openid, verifiedAt: new Date().toISOString() };
  await saveState();
  const response = { ok: true, required: true, status, method: "miniProgram" };
  if (active || !includeNavigation) return response;
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
