const growthService = require("../services/growth-service");

async function handleGrowthRoutes(ctx) {
  const { req, url, state, user, send } = ctx;

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/invite/info") {
    return send(ctx.res, 200, growthService.getInviteInfo(state, user));
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/invite/list") {
    for (const [name, maximum] of [["page", 1000000], ["count", 100]]) {
      const value = url.searchParams.get(name);
      if (value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum)) return send(ctx.res, 400, { error: `${name} 必须为 1 到 ${maximum} 的整数` });
    }
    return send(ctx.res, 200, growthService.listInviteUsers(state, user, Object.fromEntries(url.searchParams.entries())));
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/invite/stats") {
    return send(ctx.res, 200, growthService.getInviteStats(state, user));
  }

  if (req.method === "GET" && url.pathname === "/api/daily-signin/status") return send(ctx.res, 200, growthService.getDailySigninStatus(state, user));
  if (req.method === "POST" && url.pathname === "/api/daily-signin/claim") {
    const result = growthService.claimDailySignin(state, user);
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? result : { error: result.error });
  }

  // Retire old clients without consuming tickets or changing historical balances.
  if (["/api/signin/status", "/api/signin/start", "/api/signin/ad_complete", "/api/signin/lottery_spin"].includes(url.pathname)) {
    return send(ctx.res, 410, { error: "广告签到功能已下线", code: "AD_FEATURE_REMOVED" });
  }

  return false;
}

module.exports = {
  handleGrowthRoutes
};
