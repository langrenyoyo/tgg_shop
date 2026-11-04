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
  const response = await fetchImpl(`${String(env.HF_BASE_URL).replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ comKey: env.HF_COM_KEY, timestamp: Math.floor(Date.now() / 1000), data: encryptData(data, env.HF_COM_SECRET, env.HF_COM_KEY) }) });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && Number(body.code) === 200, httpStatus: response.status, body, error: Number(body.code) === 200 ? undefined : body.message || "汇服八方接口返回失败" };
}
function decodeCallback(body, env = process.env) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("提现回调格式错误");
  if (body.data && typeof body.data === "string") return decryptData(body.data, env.HF_COM_SECRET, env.HF_COM_KEY);
  if (body.data && typeof body.data === "object") return body.data;
  return body;
}
module.exports = { transferMode, activeAuthorization, isConfigured, encryptData, decryptData, decodeCallback, submit: (p, e, f) => request("/wx/transfer/pay", p, e, f), query: (p, e, f) => request("/wx/transfer/query", p, e, f) };
