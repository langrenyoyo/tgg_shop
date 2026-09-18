const { request } = require("./api");
async function pay(payment) {
  if (payment.status === "paid") return payment;
  if (payment.metadata?.lfwin?.providerOrderNo || payment.metadata?.lfwin?.submissionState) {
    const current = await request(`/api/payments/${encodeURIComponent(payment.payNo)}/lfwin/query`, { method: "POST", data: {} });
    if (current.payment?.status === "paid") return current.payment;
    if (current.payment?.status !== "pending") throw new Error("支付单状态已变更，请刷新后重试");
  }
  const initiated = await request(`/api/payments/${encodeURIComponent(payment.payNo)}/lfwin`, { method: "POST", data: { method: "wechat_mini" } });
  const fields = initiated.provider?.requestPayment;
  if (!fields) throw new Error("支付平台未返回小程序支付参数，请联系客服");
  await new Promise((resolve, reject) => wx.requestPayment({ ...fields, success: resolve, fail: error => reject(new Error(error.errMsg?.includes("cancel") ? "已取消支付，可稍后继续" : "支付未完成，请查询订单状态")) }));
  const result = await request(`/api/payments/${encodeURIComponent(payment.payNo)}/lfwin/query`, { method: "POST", data: {} });
  if (result.payment?.status !== "paid") throw new Error("支付结果确认中，请稍后刷新");
  return result.payment;
}
module.exports = { pay };
