const crypto = require("crypto");
function transferMode(withdrawal = {}, env = process.env) {
  // Orders submitted before mode snapshots were introduced used CONFIRM.
  // Never reinterpret those orders when the deployment's default changes.
  const legacySubmitted = withdrawal.status === "processing" || withdrawal.submittedAt || withdrawal.providerMerchantOrderId;
  return withdrawal.transferMode || (legacySubmitted ? "CONFIRM" : env.HF_TRANSFER_MODE || "AUTH");
}
function activeAuthorization(user, env = process.env, now = Date.now()) {
  // This is an internal record, not a provider response or client input schema.
  // Only a verified provider integration may write user.huifuAuthorization.
  const auth = user?.huifuAuthorization;
  const openid = String(user?.wechatOpenid || user?.openid || "").trim();
  const appid = env.HF_WECHAT_APPID || env.WECHAT_APPID;
  if (!auth || auth.status !== "active" || !openid || !appid || !env.HF_MERCHANT_ID) return null;
  if (auth.openid !== openid || auth.appid !== appid || auth.merchantId !== env.HF_MERCHANT_ID) return null;
  if (typeof auth.authorizationNo !== "string" || !auth.authorizationNo.trim()) return null;
  const verifiedAt = Date.parse(auth.verifiedAt);
  if (!Number.isFinite(verifiedAt) || verifiedAt > now) return null;
  if (auth.expiresAt && !(Date.parse(auth.expiresAt) > now)) return null;
  return { ...auth, authorizationNo: auth.authorizationNo.trim() };
}
function isConfigured(env = process.env) {
  const appId = env.HF_WECHAT_APPID || env.WECHAT_APPID;
  return Boolean(env.HF_COM_KEY && env.HF_COM_SECRET && env.HF_BASE_URL && env.HF_MERCHANT_ID && appId);
}
function cipherKey(secret) {
  const key = Buffer.from(String(secret), "utf8");
  if (key.length !== 32) throw new Error("HF_COM_SECRET must be exactly 32 UTF-8 bytes");
  return key;
}
function cipherIv(comKey) {
  const iv = Buffer.from(String(comKey), "utf8");
  if (iv.length !== 16) throw new Error("HF_COM_KEY must be exactly 16 UTF-8 bytes");
  return iv;
}
function encryptData(data, secret, comKey) {
  const cipher = crypto.createCipheriv("aes-256-cbc", cipherKey(secret), cipherIv(comKey));
  return Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]).toString("base64");
}
function decryptData(value, secret, comKey) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", cipherKey(secret), cipherIv(comKey));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(String(value), "base64")), decipher.final()]).toString("utf8"));
}
async function request(path, data, env = process.env, fetchImpl = global.fetch) {
  if (!isConfigured(env)) return { ok: false, configured: false, error: "汇服八方提现通道未配置" };
  const response = await fetchImpl(`${String(env.HF_BASE_URL).replace(/\/$/, "")}${path}`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" }, body: JSON.stringify({ comKey: env.HF_COM_KEY, timestamp: Math.floor(Date.now() / 1000), data: encryptData(data, env.HF_COM_SECRET, env.HF_COM_KEY) }) });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && Number(body.code) === 200, httpStatus: response.status, body, error: Number(body.code) === 200 ? undefined : body.message || "汇服八方接口返回失败" };
}
async function authorizationStart(data, env = process.env, fetchImpl = global.fetch) {
  const path = String(env.HF_AUTHORIZATION_PATH || "/wx/auth/apply").trim();
  if (path !== "/wx/auth/apply") {
    return { ok: false, configured: false, error: "汇付 AUTH 授权接口路径配置无效" };
  }
  const startedAt = Date.now();
  try {
    const result = await request(path, data, env, fetchImpl);
    console.info("[huifu-auth] provider response", JSON.stringify({
      event: "authorization_start_response",
      path,
      ok: result.ok,
      configured: result.configured !== false,
      httpStatus: result.httpStatus ?? null,
      providerCode: result.body?.code ?? null,
      responseKeys: result.body && typeof result.body === "object" ? Object.keys(result.body).sort() : [],
      dataKeys: result.body?.data && typeof result.body.data === "object" ? Object.keys(result.body.data).sort() : [],
      authorizationState: ["WAIT_USER_CONFIRM", "TAKING_EFFECT", "CLOSED"].includes(result.body?.data?.state) ? result.body.data.state : null,
      durationMs: Date.now() - startedAt
    }));
    return result;
  } catch (error) {
    console.error("[huifu-auth] provider request error", JSON.stringify({
      event: "authorization_start_error",
      path,
      errorType: error?.name || "Error",
      durationMs: Date.now() - startedAt
    }));
    throw error;
  }
}

function decodeCallback(body, env = process.env) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("提现回调格式错误");
  if (body.comKey !== env.HF_COM_KEY || typeof body.data !== "string" || !Number.isSafeInteger(Number(body.timestamp)) || Number(body.timestamp) <= 0) throw new Error("回调加密信封无效");
  return decryptData(body.data, env.HF_COM_SECRET, env.HF_COM_KEY);
}
module.exports = {
  transferMode,
  activeAuthorization,
  isConfigured,
  encryptData,
  decryptData,
  decodeCallback,
  authorizationStart,
  authorizationQuery: (p, e, f) => request("/wx/auth/query", p, e, f),
  submit: (p, e, f) => request("/wx/transfer/pay", p, e, f),
  query: (p, e, f) => request("/wx/transfer/query", p, e, f)
};
