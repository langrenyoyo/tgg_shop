const orderService = require("../services/order-service");

async function handleOrderRoutes(ctx) {
  const { req, url, state, user, send, readBody, publicUser } = ctx;

  if (req.method === "POST" && url.pathname === "/api/member/subscribe") {
    const body = await readBody(req);
    const result = orderService.subscribeMember(state, user, body);
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? result.user : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/orders") {
    return send(ctx.res, 200, orderService.listUserOrders(state, user.id));
  }

  if (req.method === "GET" && url.pathname === "/api/payments") {
    return send(ctx.res, 200, orderService.listUserPayments(state, user.id));
  }

  if (req.method === "POST" && url.pathname === "/api/payment-providers/lfwin/notify") {
    const result = orderService.handleLfwinPaymentNotification(state, await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? "success" : "fail", { "Content-Type": "text/plain; charset=utf-8" });
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    const result = orderService.submitOrder(state, user.id, await readBody(req));
    return send(ctx.res, result.ok ? 201 : 400, result.ok ? result.order : { error: result.error });
  }

  const payMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/pay$/);
  if (req.method === "POST" && payMatch) {
    const result = orderService.submitPayment(state, payMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 200 : 400, result.ok ? result.order : { error: result.error });
  }

  const paymentMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/payments$/);
  if (req.method === "POST" && paymentMatch) {
    const result = orderService.createOrderPayment(state, paymentMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 201 : result.status || 400, result.ok ? result.payment : { error: result.error });
  }

  const lfwinInitiateMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/lfwin$/);
  if (req.method === "POST" && lfwinInitiateMatch) {
    const payment = state.paymentLedger.find((item) => item.payNo === lfwinInitiateMatch[1] || item.id === lfwinInitiateMatch[1]);
    if (!payment || payment.userId !== user.id) return send(ctx.res, 404, { error: "Payment not found" });
    const result = await orderService.initiateLfwinPayment(state, lfwinInitiateMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? { payment: result.payment, provider: result.provider } : { error: result.error });
  }

  const lfwinQueryMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/lfwin\/query$/);
  if (req.method === "POST" && lfwinQueryMatch) {
    const payment = state.paymentLedger.find((item) => item.payNo === lfwinQueryMatch[1] || item.id === lfwinQueryMatch[1]);
    if (!payment || payment.userId !== user.id) return send(ctx.res, 404, { error: "Payment not found" });
    const result = await orderService.queryLfwinPayment(state, lfwinQueryMatch[1]);
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? result : { error: result.error });
  }

  const lfwinCloseMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/lfwin\/close$/);
  if (req.method === "POST" && lfwinCloseMatch) {
    const payment = state.paymentLedger.find((item) => item.payNo === lfwinCloseMatch[1] || item.id === lfwinCloseMatch[1]);
    if (!payment || payment.userId !== user.id) return send(ctx.res, 404, { error: "Payment not found" });
    const result = await orderService.closeLfwinPayment(state, lfwinCloseMatch[1]);
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? result : { error: result.error });
  }

  const callbackMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/mock-callback$/);
  if (req.method === "POST" && callbackMatch) {
    const result = orderService.handlePaymentCallback(state, callbackMatch[1], await readBody(req));
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? { payment: result.payment, result: result.result, idempotent: result.idempotent } : { error: result.error });
  }

  const refundMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/refunds$/);
  if (req.method === "POST" && refundMatch) {
    const body = await readBody(req);
    const result = orderService.requestRefund(state, user.id, refundMatch[1], body.reason);
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.refundOrder : { error: result.error });
  }

  return false;
}

module.exports = {
  handleOrderRoutes
};
