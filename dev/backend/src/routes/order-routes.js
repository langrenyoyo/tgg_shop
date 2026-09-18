const orderService = require("../services/order-service");
const userOrders = require("../services/user-order-service");
const { saveState } = require("../data/store");
const paymentService = require("../services/payment-service");

async function handleOrderRoutes(ctx) {
  const { req, url, state, user, send, readBody, publicUser } = ctx;

  const ownedOrderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)(?:\/(pay|payments|refunds|cancel|receive))?$/);
  if (ownedOrderMatch && !state.orders.some(order => order.id === ownedOrderMatch[1] && order.userId === user.id)) return send(ctx.res, 404, { error: "订单不存在" });
  if (ownedOrderMatch && req.method === "GET" && !ownedOrderMatch[2]) return send(ctx.res, 200, userOrders.detail(state, user.id, ownedOrderMatch[1]));
  if (ownedOrderMatch && req.method === "POST" && ["cancel", "receive"].includes(ownedOrderMatch[2])) {
    const result = await userOrders[ownedOrderMatch[2]](state, user.id, ownedOrderMatch[1]);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.order : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/member/subscribe") {
    const body = await readBody(req);
    const result = orderService.subscribeMember(state, user, body);
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? result.user : { error: result.error });
  }

  if (req.method === "POST" && url.pathname === "/api/member/payments") {
    const body = await readBody(req);
    const result = paymentService.createMemberPayment(state, user, { months: body.months, idempotencyKey: body.idempotencyKey, channel: "lfwin_wechat_mini" });
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.payment : { error: result.error });
  }

  if (req.method === "GET" && url.pathname === "/api/orders") {
    const query = Object.fromEntries(url.searchParams.entries());
    if (query.status && !["pending_payment", "paid", "completed", "cancelled", "closed", "refunding", "refunded"].includes(query.status)) return send(ctx.res, 400, { error: "无效订单状态" });
    if (query.fulfillmentStatus && !["pending_pickup", "picked_up", "pending_ship", "shipping", "delivered"].includes(query.fulfillmentStatus)) return send(ctx.res, 400, { error: "无效履约状态" });
    for (const key of ["page", "count"]) {
      if (query[key] !== undefined && (!/^\d+$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])) || Number(query[key]) < 1 || (key === "count" && Number(query[key]) > 100))) return send(ctx.res, 400, { error: "无效分页参数" });
    }
    return send(ctx.res, 200, orderService.listUserOrders(state, user.id, query));
  }

  if (req.method === "GET" && url.pathname === "/api/payments") {
    return send(ctx.res, 200, orderService.listUserPayments(state, user.id));
  }

  const refundDetailMatch = url.pathname.match(/^\/api\/refunds\/([^/]+)$/);
  if (req.method === "GET" && refundDetailMatch) {
    const refund = userOrders.refundDetail(state, user.id, refundDetailMatch[1]);
    return send(ctx.res, refund ? 200 : 404, refund || { error: "退款单不存在" });
  }

  if (req.method === "POST" && url.pathname === "/api/payment-providers/lfwin/notify") {
    const result = orderService.handleLfwinPaymentNotification(state, await readBody(req));
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? "success" : "fail", { "Content-Type": "text/plain; charset=utf-8" });
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    const result = orderService.submitOrder(state, user.id, await readBody(req));
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 201 : result.status || 400, result.ok ? result.order : { error: result.error });
  }

  const payMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/pay$/);
  if (req.method === "POST" && payMatch) {
    const result = orderService.submitPayment(state, payMatch[1], await readBody(req));
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 200 : 400, result.ok ? result.order : { error: result.error });
  }

  const paymentMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/payments$/);
  if (req.method === "POST" && paymentMatch) {
    const result = orderService.createOrderPayment(state, paymentMatch[1], await readBody(req));
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 201 : result.status || 400, result.ok ? result.payment : { error: result.error });
  }

  const lfwinInitiateMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/lfwin$/);
  if (req.method === "POST" && lfwinInitiateMatch) {
    const payment = state.paymentLedger.find((item) => item.payNo === lfwinInitiateMatch[1] || item.id === lfwinInitiateMatch[1]);
    if (!payment || payment.userId !== user.id) return send(ctx.res, 404, { error: "Payment not found" });
    const body = await readBody(req);
    if (body.method === "wechat_mini" && (!user.wechatOpenid || !process.env.WECHAT_APPID)) return send(ctx.res, 400, { error: "请使用微信登录，且服务端需配置小程序 AppID" });
    const result = await orderService.initiateLfwinPayment(state, lfwinInitiateMatch[1], { ...body, appId: body.method === "wechat_mini" ? process.env.WECHAT_APPID : body.appId, openId: body.method === "wechat_mini" ? user.wechatOpenid : body.openId });
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? { payment: result.payment, provider: result.provider } : { error: result.error });
  }

  const lfwinQueryMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/lfwin\/query$/);
  if (req.method === "POST" && lfwinQueryMatch) {
    const payment = state.paymentLedger.find((item) => item.payNo === lfwinQueryMatch[1] || item.id === lfwinQueryMatch[1]);
    if (!payment || payment.userId !== user.id) return send(ctx.res, 404, { error: "Payment not found" });
    const result = await orderService.queryLfwinPayment(state, lfwinQueryMatch[1]);
    if (result.ok) await saveState();
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
    if (process.env.NODE_ENV === "production") return send(ctx.res, 403, { error: "生产环境禁止模拟支付" });
    if (!state.paymentLedger.some(payment => payment.payNo === callbackMatch[1] && payment.userId === user.id)) return send(ctx.res, 404, { error: "支付单不存在" });
    const result = orderService.handlePaymentCallback(state, callbackMatch[1], await readBody(req));
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 200 : result.status || 400, result.ok ? { payment: result.payment, result: result.result, idempotent: result.idempotent } : { error: result.error });
  }

  const refundMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/refunds$/);
  if (req.method === "POST" && refundMatch) {
    const body = await readBody(req);
    const result = orderService.requestRefund(state, user.id, refundMatch[1], body.reason);
    if (result.ok) await saveState();
    return send(ctx.res, result.ok ? 201 : result.status, result.ok ? result.refundOrder : { error: result.error });
  }

  return false;
}

module.exports = {
  handleOrderRoutes
};
