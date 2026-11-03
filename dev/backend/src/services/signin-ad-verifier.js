// Integration boundary for an independently verified ad receipt service.
// This is NOT a WeChat API or a client onClose verifier. The adapter must verify
// provider evidence and bind it to the exact attempt/step before returning true.
function configured(env = process.env) {
  try { const url = new URL(env.SIGNIN_AD_VERIFIER_URL); return url.protocol === "https:" && !url.username && !url.password && Boolean(env.SIGNIN_AD_VERIFIER_TOKEN); } catch { return false; }
}
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
module.exports = { configured, verify };
