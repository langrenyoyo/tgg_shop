const crypto = require("crypto");
function isConfigured(env = process.env) { return Boolean(env.HF_COM_KEY && env.HF_COM_SECRET && env.HF_BASE_URL); }
function encryptData(data, secret) {
  const key = crypto.createHash("sha256").update(String(secret)).digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]).toString("base64");
}
async function request(path, data, env = process.env, fetchImpl = global.fetch) {
  if (!isConfigured(env)) return { ok: false, configured: false, error: "汇服八方提现通道未配置" };
  const response = await fetchImpl(`${String(env.HF_BASE_URL).replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ comKey: env.HF_COM_KEY, timestamp: Date.now().toString(), data: encryptData(data, env.HF_COM_SECRET) }) });
  return { ok: response.ok, httpStatus: response.status, body: await response.json().catch(() => ({})) };
}
module.exports = { isConfigured, encryptData, submit: (p, e, f) => request("/wx/transfer/pay", p, e, f), query: (p, e, f) => request("/wx/transfer/query", p, e, f) };
