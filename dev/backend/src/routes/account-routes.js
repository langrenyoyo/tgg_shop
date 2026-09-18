const accountService = require("../services/account-service");
const withdrawalService = require("../services/withdrawal-service");
const { authenticateCallback } = require("../services/callback-auth");

async function handleAccountRoutes(ctx) {
  const { req, url, state, user, send, readBody } = ctx;

  if (req.method === "POST" && url.pathname === "/api/providers/huifu/withdraw-callback") {
    const auth = authenticateCallback(req, url, "HF_CALLBACK_TOKEN", "x-huifu-callback-token");
    if (!auth.ok) return send(ctx.res, auth.status, { error: auth.error });
    const result = withdrawalService.handleCallback(state, await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? { success: true, withdrawal: result.withdrawal } : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/pickup-sites") {
    return send(ctx.res, 200, accountService.listPickupSites(state));
  }

  if (req.method === "GET" && url.pathname === "/api/delivery/teams") {
    return send(ctx.res, 200, accountService.listDeliveryTeams(state));
  }

  if (req.method === "GET" && url.pathname === "/api/addresses") {
    return send(ctx.res, 200, accountService.listAddresses(state, user.id));
  }

  if (req.method === "POST" && url.pathname === "/api/addresses") {
    return send(ctx.res, 201, accountService.createAddress(state, user.id, await readBody(req)));
  }

  const addressMatch = url.pathname.match(/^\/api\/addresses\/([^/]+)$/);
  if ((req.method === "PUT" || req.method === "PATCH") && addressMatch) {
    const result = accountService.updateAddress(state, user.id, addressMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.address : { error: result.error });
  }

  if (req.method === "DELETE" && addressMatch) {
    const result = accountService.deleteAddress(state, user.id, addressMatch[1]);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.address : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/withdrawals") {
    return send(ctx.res, 200, accountService.listWithdrawals(state, user.id));
  }
  const withdrawalMatch = url.pathname.match(/^\/api\/withdrawals\/([^/]+)$/);
  if (req.method === "GET" && withdrawalMatch) {
    const withdrawal = accountService.getWithdrawal(state, user.id, withdrawalMatch[1]);
    return send(ctx.res, withdrawal ? 200 : 404, withdrawal || { error: "提现记录不存在" });
  }

  if (req.method === "POST" && url.pathname === "/api/withdrawals") {
    const result = accountService.requestWithdrawal(state, user, await readBody(req));
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.withdrawal : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/points-ledger") {
    for (const [name, maximum] of [["page", 1000000], ["count", 100]]) {
      const value = url.searchParams.get(name);
      if (value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum)) return send(ctx.res, 400, { error: `${name} 必须为 1 到 ${maximum} 的整数` });
    }
    if (![null, "", "in", "out"].includes(url.searchParams.get("direction"))) return send(ctx.res, 400, { error: "无效积分收支方向" });
    return send(ctx.res, 200, accountService.getPointLedger(state, user.id, Object.fromEntries(url.searchParams.entries())));
  }

  if (req.method === "GET" && url.pathname === "/api/ranking") {
    return send(ctx.res, 200, accountService.getRanking(state, user.id));
  }

  if (req.method === "GET" && url.pathname === "/api/tickets") {
    return send(ctx.res, 200, accountService.listTickets(state, user.id));
  }

  if (req.method === "POST" && url.pathname === "/api/tickets") {
    const result = accountService.createTicket(state, user, await readBody(req));
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.ticket : { error: result.error });
  }

  return false;
}

module.exports = {
  handleAccountRoutes
};
