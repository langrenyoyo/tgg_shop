const authService = require("../services/auth-service");
const { updateProfile } = require("../services/profile-service");

async function handleAuthRoutes(ctx) {
  const { req, url, state, user, send, readBody, publicUser } = ctx;

  if (req.method === "GET" && url.pathname === "/api/auth/me") return send(ctx.res, 200, authService.getCurrentUser(user));

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const result = authService.login(state, body);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/wechat-login") {
    const body = await readBody(req);
    const result = await authService.wechatLogin(state, body);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const result = authService.logout(state, req);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? { ok: true } : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/refresh") {
    const result = authService.refresh(state, await readBody(req), "user");
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/auth/login") {
    const result = authService.adminLogin(state, await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/station/auth/login") {
    const result = authService.stationLogin(state, await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/auth/logout") {
    const result = authService.logout(state, req);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? { ok: true } : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/station/auth/logout") {
    const result = authService.logout(state, req);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? { ok: true } : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/auth/refresh") {
    const result = authService.refresh(state, await readBody(req), "admin");
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/station/auth/refresh") {
    const result = authService.refresh(state, await readBody(req), "station");
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/me") return send(ctx.res, 200, authService.getCurrentUser(user));

  if (req.method === "PATCH" && url.pathname === "/api/me") {
    const result = await updateProfile(user, await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.user : { error: result.error });
  }

  return false;
}

module.exports = {
  handleAuthRoutes
};
