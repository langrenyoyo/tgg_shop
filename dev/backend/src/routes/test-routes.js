const testBypass = require("../services/test-bypass-service");

async function handleTestRoutes(ctx) {
  const { req, url, state, user, send } = ctx;
  if (!url.pathname.startsWith("/api/test/")) return false;
  if (!testBypass.enabled()) return send(ctx.res, 403, { error: "测试快捷操作未开启" });

  const paymentMatch = url.pathname.match(/^\/api\/test\/payments\/([^/]+)\/settle$/);
  if (req.method === "POST" && paymentMatch) {
    const result = testBypass.settlePayment(state, user, paymentMatch[1]);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  const withdrawalMatch = url.pathname.match(/^\/api\/test\/withdrawals\/([^/]+)\/complete$/);
  if (req.method === "POST" && withdrawalMatch) {
    const result = testBypass.completeWithdrawal(state, user, withdrawalMatch[1]);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }
  return send(ctx.res, 404, { error: "测试接口不存在" });
}

module.exports = { handleTestRoutes };
