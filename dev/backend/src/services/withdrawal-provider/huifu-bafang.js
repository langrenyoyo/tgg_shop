const crypto = require("crypto");
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
module.exports = { isConfigured, encryptData, decryptData, decodeCallback, submit: (p, e, f) => request("/wx/transfer/pay", p, e, f), query: (p, e, f) => request("/wx/transfer/query", p, e, f) };
