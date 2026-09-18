const growthService = require("../services/growth-service");
const { saveState } = require("../data/store");

async function handleGrowthRoutes(ctx) {
  const { req, url, state, user, send, readBody } = ctx;

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

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/signin/status") {
    return send(ctx.res, 200, growthService.getSigninStatus(state, user));
  }

  if (req.method === "POST" && url.pathname === "/api/signin/start") {
    const result = growthService.startSignin(state, user);
    await saveState();
    return send(ctx.res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/signin/ad_complete") {
    const body = await readBody(req);
    const result = growthService.completeSigninAd(state, user, body.sessionId, body.adType, body.completionToken);
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/signin/lottery_spin") {
    const result = growthService.spinLottery(state, user);
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.prize : { error: result.error });
  }

  return false;
}

module.exports = {
  handleGrowthRoutes
};
