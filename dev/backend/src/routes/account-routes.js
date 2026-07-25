const accountService = require("../services/account-service");

async function handleAccountRoutes(ctx) {
  const { req, url, state, user, send, readBody } = ctx;

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

  if (req.method === "POST" && url.pathname === "/api/withdrawals") {
    const result = accountService.requestWithdrawal(state, user, await readBody(req));
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.withdrawal : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/points-ledger") {
    return send(ctx.res, 200, accountService.getPointLedger(state, user.id));
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
