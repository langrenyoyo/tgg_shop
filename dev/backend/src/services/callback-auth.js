const crypto = require("node:crypto");
const { taskCallbackToken } = require("../config/runtime-safety");

function authenticateCallback(req, url, envName, headerName) {
  const expected = envName === "TGG_TASK_CALLBACK_TOKEN"
    ? taskCallbackToken(process.env)
    : process.env[envName];
  if (!expected) return { ok: false, status: 503, error: "回调认证尚未配置" };
  const received = req.headers?.[headerName] || url.searchParams.get("token") || "";
  const actualBytes = Buffer.from(String(received));
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return { ok: false, status: 401, error: "回调凭据无效" };
  return { ok: true };
}
module.exports = { authenticateCallback };
