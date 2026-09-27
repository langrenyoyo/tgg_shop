const crypto = require("node:crypto");
const adminService = require("../services/admin-service");
const { syncResources, pushOrderToPospal, getStatus, integrationState } = require("../services/pospal-sync-service");
const { createPospalClient } = require("../integrations/pospal/pospal-client");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handlePospalRoutes(ctx) {
  const { req, url, state, send, readBody } = ctx;

  if (req.method === "GET" && url.pathname === "/api/admin/integrations/pospal/status") {
    const check = adminService.requirePermission(req, state, "integration:read");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    return send(ctx.res, 200, getStatus(state));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/integrations/pospal/sync") {
    const check = adminService.requirePermission(req, state, "integration:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const body = await readBody(req);
    const allowed = new Set(["products", "inventory", "customers", "tickets", "orders"]);
    const resources = (Array.isArray(body.resources) ? body.resources : []).filter(item => allowed.has(item));
    const result = await syncResources(state, resources, {
      maxPages: body.maxPages,
      limit: body.limit,
      resetCursor: body.resetCursor === true,
      autoCreate: body.autoCreate === true,
      apply: body.apply !== false
    });
    return send(ctx.res, result.ok ? 200 : (result.status || 503), result);
  }

  const pushMatch = url.pathname.match(/^\/api\/admin\/integrations\/pospal\/orders\/([^/]+)\/push$/);
  if (req.method === "POST" && pushMatch) {
    const check = adminService.requirePermission(req, state, "integration:write");
    if (!check.ok) return send(ctx.res, check.status, { error: check.error, role: check.role });
    const result = await pushOrderToPospal(state, createPospalClient(), pushMatch[1]);
    return send(ctx.res, result.ok ? 200 : (result.status || 502), result);
  }

  if (req.method === "POST" && url.pathname === "/api/pospal/callback") {
    const configuredToken = String(process.env.POSPAL_CALLBACK_TOKEN || "").trim();
    const providedToken = req.headers["x-pospal-callback-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if ((configuredToken && !safeEqual(providedToken, configuredToken)) || (process.env.NODE_ENV === "production" && !configuredToken)) {
      return send(ctx.res, configuredToken ? 401 : 503, { error: configuredToken ? "POSPAL回调鉴权失败" : "POSPAL_CALLBACK_TOKEN未配置" });
    }
    const body = await readBody(req);
    const eventId = String(body.eventId || body.id || body.requestId || `${body.eventType || body.type || "unknown"}:${body.uid || body.orderNo || Date.now()}`);
    const integration = integrationState(state);
    integration.callbackEvents = Array.isArray(integration.callbackEvents) ? integration.callbackEvents : [];
    const existed = integration.callbackEvents.some(item => item.eventId === eventId);
    let sync = null;
    if (!existed) {
      integration.callbackEvents.unshift({ eventId, eventType: body.eventType || body.type || "unknown", receivedAt: new Date().toISOString() });
      integration.callbackEvents = integration.callbackEvents.slice(0, 1000);
      const eventType = String(body.eventType || body.type || body.event || "");
      const resource = eventType.includes("productOrder") ? "orders"
        : eventType.includes("ticket") ? "tickets"
        : eventType.includes("customer") ? "customers"
        : eventType.includes("product") ? "products" : "";
      if (resource) sync = await syncResources(state, [resource], { maxPages: 2 });
    }
    return send(ctx.res, 200, { ok: true, eventId, idempotent: existed, sync });
  }

  return false;
}

module.exports = { handlePospalRoutes };
