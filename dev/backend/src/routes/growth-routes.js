const growthService = require("../services/growth-service");

async function handleGrowthRoutes(ctx) {
  const { req, url, state, user, send, readBody } = ctx;

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/invite/info") {
    return send(ctx.res, 200, growthService.getInviteInfo(state, user));
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/invite/list") {
    return send(ctx.res, 200, growthService.listInviteUsers(state, user));
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/invite/stats") {
    return send(ctx.res, 200, growthService.getInviteStats(state, user));
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/signin/status") {
    return send(ctx.res, 200, growthService.getSigninStatus(state, user));
  }

  if (req.method === "POST" && url.pathname === "/api/signin/start") {
    return send(ctx.res, 200, growthService.startSignin(state, user));
  }

  if (req.method === "POST" && url.pathname === "/api/signin/ad_complete") {
    const body = await readBody(req);
    const result = growthService.completeSigninAd(state, user, body.sessionId);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/signin/lottery_spin") {
    const result = growthService.spinLottery(state, user);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.prize : { error: result.error });
  }

  return false;
}

module.exports = {
  handleGrowthRoutes
};
