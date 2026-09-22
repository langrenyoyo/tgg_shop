const { resolveStation } = require("../domain/auth");
const stationService = require("../services/station-service");

async function handleStationRoutes(ctx) {
  const { req, url, state, send, readBody } = ctx;
  if (!url.pathname.startsWith("/api/station/")) return false;
  if (req.method === "POST" && url.pathname === "/api/station/auth/login") return false;
  if (req.method === "POST" && url.pathname === "/api/station/auth/logout") return false;
  if (req.method === "POST" && url.pathname === "/api/station/auth/refresh") return false;
  const auth = resolveStation(req, state);
  if (!auth.ok) return send(ctx.res, auth.status || 401, { error: auth.error || "请先登录站点" });
  const account = auth.account;
  if (req.method === "GET" && url.pathname === "/api/station/me") return send(ctx.res, 200, { station: stationService.publicStation(account), sites: (state.pickupSites || []).filter((site) => account.siteIds.includes(site.id)) });
  if (req.method === "GET" && url.pathname === "/api/station/dashboard") return send(ctx.res, 200, stationService.dashboard(state, account));
  if (req.method === "GET" && url.pathname === "/api/station/orders") return send(ctx.res, 200, stationService.listOrders(state, account, Object.fromEntries(url.searchParams.entries())));
  if (req.method === "GET" && url.pathname === "/api/station/operation-logs") return send(ctx.res, 200, stationService.logs(state, account, Object.fromEntries(url.searchParams.entries())));
  const orderMatch = url.pathname.match(/^\/api\/station\/orders\/([^/]+)$/);
  if (req.method === "GET" && orderMatch) {
    const order = stationService.findAccessibleOrder(state, account, orderMatch[1]);
    return send(ctx.res, order ? 200 : 404, order ? stationService.safeOrder(order, (state.stationOrders || []).find((item) => item.orderId === order.id)) : { error: "订单不存在或不属于当前站点" });
  }
  const receiveMatch = url.pathname.match(/^\/api\/station\/orders\/([^/]+)\/receive$/);
  if (req.method === "POST" && receiveMatch) {
    const result = stationService.receive(state, account, receiveMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? result : { error: result.error });
  }
  const pickupMatch = url.pathname.match(/^\/api\/station\/orders\/([^/]+)\/pickup-verify$/);
  if (req.method === "POST" && pickupMatch) {
    const result = stationService.pickup(state, account, pickupMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? result : { error: result.error });
  }
  const exceptionMatch = url.pathname.match(/^\/api\/station\/orders\/([^/]+)\/exceptions$/);
  if (req.method === "POST" && exceptionMatch) {
    const result = stationService.createException(state, account, exceptionMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 201 : result.status || 400, result.ok ? result : { error: result.error });
  }
  return send(ctx.res, 404, { error: "Station API not found" });
}

module.exports = { handleStationRoutes };
