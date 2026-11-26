// Integration boundary for an independently verified ad receipt service.
// The external adapter verifies provider evidence bound to the attempt/step.
// Explicit wechat_client mode is processed separately by coin-signin-service;
// its SDK callback is a client report, never independent signed evidence.
function configured(env = process.env) {
  if (nativeMode(env)) return true;
  try { const url = new URL(env.SIGNIN_AD_VERIFIER_URL); return url.protocol === "https:" && !url.username && !url.password && Boolean(env.SIGNIN_AD_VERIFIER_TOKEN); } catch { return false; }
}
function nativeMode(env = process.env) { return env.SIGNIN_AD_VERIFICATION_MODE === 'wechat_client'; }
async function verify(context) {
  if (!configured()) throw new Error("广告完成验证尚未配置");
  const response = await fetch(process.env.SIGNIN_AD_VERIFIER_URL, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SIGNIN_AD_VERIFIER_TOKEN}` },
    body: JSON.stringify(context)
  });
  if (!response.ok) throw new Error("广告完成验证暂不可用");
  const result = await response.json();
  if (result.verified !== true || result.userId !== context.userId || result.attemptId !== context.attemptId
    || result.stepId !== context.stepId || result.adUnitId !== context.adUnitId
    || typeof result.receiptId !== "string" || !result.receiptId.trim() || result.receiptId.length > 200) return null;
  return { receiptId: result.receiptId };
}
module.exports = { configured, verify, nativeMode };
