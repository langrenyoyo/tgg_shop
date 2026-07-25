const { getState } = require("../data/store");
const { resolveUser } = require("../domain/auth");
const { send, readBody, publicUser } = require("../http/http-utils");
const { handleAuthRoutes } = require("./auth-routes");
const { handleCatalogRoutes } = require("./catalog-routes");
const { handleOrderRoutes } = require("./order-routes");
const { handleTaskRoutes } = require("./task-routes");
const { handleGrowthRoutes } = require("./growth-routes");
const { handleAccountRoutes } = require("./account-routes");
const { handleAdminRoutes } = require("./admin-routes");

const routeHandlers = [
  handleAuthRoutes,
  handleCatalogRoutes,
  handleOrderRoutes,
  handleTaskRoutes,
  handleGrowthRoutes,
  handleAccountRoutes,
  handleAdminRoutes
];

async function routeApi(req, res, url) {
  const state = getState();
  const userAuth = resolveUser(req, state);
  const user = userAuth.ok ? userAuth.user : null;

  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, service: "tgg-shop-dev" });
  }
  if (requiresUserAuth(req, url) && !userAuth.ok) {
    return send(res, userAuth.status || 401, { error: userAuth.error || "请先登录" });
  }

  const ctx = {
    req,
    res,
    url,
    state,
    user,
    send,
    readBody,
    publicUser
  };

  for (const handler of routeHandlers) {
    if (await handler(ctx)) return true;
  }

  return send(res, 404, { error: "API not found" });
}

function requiresUserAuth(req, url) {
  if (url.pathname === "/api/auth/login") return false;
  if (url.pathname === "/api/auth/refresh") return false;
  if (url.pathname === "/api/admin/auth/login") return false;
  if (url.pathname === "/api/admin/auth/refresh") return false;
  if (url.pathname.startsWith("/api/admin/")) return false;
  if (req.method === "GET" && ["/api/config", "/api/home", "/api/products", "/api/points-exchange", "/api/task-types", "/api/tasks", "/api/task-platform/status", "/api/pickup-sites", "/api/delivery/teams"].includes(url.pathname)) return false;
  if (req.method === "GET" && /^\/api\/products\/[^/]+$/.test(url.pathname)) return false;
  if (req.method === "GET" && /^\/api\/tasks\/[^/]+$/.test(url.pathname)) return false;
  return true;
}

module.exports = {
  routeApi
};
