const { nextId, saveState } = require("../data/store");
const { createException } = require("../domain/exception-rules");
const { settleProviderRefund } = require("../domain/refund-rules");
const { createLfwinClient } = require("./lfwin-payment-client");
const refundRepository = require("../repositories/refund-repository");

function prepareRefundApproval(state, refundId) {
  const refund = refundRepository.findById(state, refundId);
  if (!refund) return { ok: false, status: 404, error: "退款单不存在" };
  if (refund.status === "refunded") return { ok: true, refundOrder: refund, idempotent: true };
  if (refund.status !== "pending_review") return { ok: false, status: 400, error: "退款单状态不允许审批" };
  if (!refund.refundCashAmount) return { ok: false, status: 409, error: "纯积分退款应使用积分退款流程" };
  const payment = findOriginalPayment(state, refund);
  if (!payment?.metadata?.lfwin?.providerOrderNo) {
    return { ok: false, status: 503, error: "原支付单没有可验证的服务商订单，不能发起真实退款" };
  }
  const now = new Date().toISOString();
  refund.status = "approved";
  refund.merchantRefundNo ||= `RFD${Date.now()}${Math.floor(Math.random() * 1000)}`;
  refund.providerOrderNo = payment.metadata.lfwin.providerOrderNo;
  refund.providerMerchantOrderNo = payment.payNo;
  refund.updatedAt = now;
  refund.approvedAt = now;
  saveState();
  return { ok: true, refundOrder: refund, awaitingProvider: true };
}

async function submitRefund(state, refundId, options = {}, client = createLfwinClient()) {
  const refund = refundRepository.findById(state, refundId);
  if (!refund) return { ok: false, status: 404, error: "退款单不存在" };
  if (refund.status === "refunded") return { ok: true, refundOrder: refund, idempotent: true };
  if (refund.status === "unknown") return { ok: false, status: 409, error: "退款发起结果未知，请先查询服务商结果" };
  if (refund.status === "failed" && options.retry === true) refund.status = "approved";
  if (refund.status !== "approved") return { ok: false, status: 400, error: "退款单尚未审批或当前不可发起" };
  const payment = findOriginalPayment(state, refund);
  if (!payment?.metadata?.lfwin?.providerOrderNo) return { ok: false, status: 503, error: "原支付单没有可验证的服务商订单" };
  if (typeof client.isConfigured === "function" && !client.isConfigured()) return { ok: false, status: 503, error: "退款服务商尚未配置" };

  refund.providerOrderNo = payment.metadata.lfwin.providerOrderNo;
  refund.providerMerchantOrderNo = payment.payNo;
  refund.merchantRefundNo ||= `RFD${Date.now()}${Math.floor(Math.random() * 1000)}`;
  refund.status = "sending";
  refund.updatedAt = new Date().toISOString();
  await saveState();

  try {
    const response = await client.refundPayment({
      providerOrderNo: refund.providerOrderNo,
      merchantOrderNo: refund.providerMerchantOrderNo,
      merchantRefundNo: refund.merchantRefundNo,
      amount: refund.refundCashAmount,
      orderTime: payment.createdAt,
      reason: refund.reason,
      notifyUrl: process.env.LFWIN_REFUND_NOTIFY_URL
    });
    validateProviderIdentity(refund, response);
    if (response.refundmoney !== undefined && !sameAmount(refund.refundCashAmount, response.refundmoney)) {
      return markRefundFailed(state, refund, "服务商退款金额与本地退款单不一致");
    }
    refund.providerRefundNo = response.refund_orderid || response.refundid || response.refund_no || response.refundNo || null;
    refund.providerStatus = String(response.refundstatus || response.refund_status || response.status || "10000");
    refund.status = providerCompleted(response) ? "refunded" : "refunding";
    refund.submittedAt ||= new Date().toISOString();
    refund.updatedAt = new Date().toISOString();
    if (refund.status === "refunded") {
      const result = settleProviderRefund(state, refund.id);
      if (!result.ok) return result;
      return { ...result, provider: response };
    }
    await saveState();
    return { ok: true, refundOrder: refund, provider: response, awaitingProvider: true };
  } catch (error) {
    refund.status = "unknown";
    refund.updatedAt = new Date().toISOString();
    createException(state, {
      type: "refund_initiation_uncertain",
      bizNo: refund.id,
      action: "查询服务商退款结果，不得自动重复发起",
      payload: { refundId: refund.id, merchantRefundNo: refund.merchantRefundNo, error: String(error.message || "provider error") }
    });
    await saveState();
    return { ok: false, status: 502, error: "退款发起结果未知，请查询服务商结果" };
  }
}

async function queryRefund(state, refundId, client = createLfwinClient()) {
  const refund = refundRepository.findById(state, refundId);
  if (!refund) return { ok: false, status: 404, error: "退款单不存在" };
  if (refund.status === "refunded") return { ok: true, refundOrder: refund, idempotent: true };
  if (!["unknown", "refunding", "approved"].includes(refund.status)) return { ok: false, status: 400, error: "当前退款单不可查询服务商" };
  const payment = findOriginalPayment(state, refund);
  if (!payment?.metadata?.lfwin?.providerOrderNo) return { ok: false, status: 503, error: "原支付单没有可验证的服务商订单" };
  try {
    const response = await client.queryRefund({
      providerOrderNo: payment.metadata.lfwin.providerOrderNo,
      merchantOrderNo: payment.payNo,
      merchantRefundNo: refund.merchantRefundNo,
      providerRefundNo: refund.providerRefundNo,
      orderTime: payment.createdAt
    });
    validateProviderIdentity(refund, response);
    if (response.refundmoney !== undefined && !sameAmount(refund.refundCashAmount, response.refundmoney)) return markRefundFailed(state, refund, "服务商查询金额与本地退款单不一致");
    refund.providerRefundNo ||= response.refund_orderid || response.refundid || response.refund_no || null;
    refund.providerStatus = String(response.refundstatus || response.refund_status || response.status || "");
    if (providerCompleted(response)) {
      const result = settleProviderRefund(state, refund.id);
      return result.ok ? { ...result, provider: response } : result;
    }
    if (providerFailed(response)) return markRefundFailed(state, refund, "服务商拒绝退款");
    refund.status = "refunding";
    refund.lastQueryAt = new Date().toISOString();
    refund.updatedAt = refund.lastQueryAt;
    await saveState();
    return { ok: true, refundOrder: refund, provider: response, awaitingProvider: true };
  } catch {
    return { ok: false, status: 502, error: "查询服务商退款结果失败" };
  }
}

function handleRefundNotification(state, payload, client = createLfwinClient()) {
  if (!client.verifyNotification(payload)) return { ok: false, status: 400, error: "Invalid LFWin refund signature" };
  const refund = findRefundByNotification(state, payload);
  if (!refund) return { ok: false, status: 404, error: "退款单不存在" };
  try { validateProviderIdentity(refund, payload); } catch { return { ok: false, status: 400, error: "Refund identity mismatch" }; }
  if (payload.refundmoney !== undefined && !sameAmount(refund.refundCashAmount, payload.refundmoney)) return { ok: false, status: 400, error: "Refund amount mismatch" };
  if (providerFailed(payload)) return markRefundFailed(state, refund, "服务商退款失败");
  if (!providerCompleted(payload)) return { ok: false, status: 400, error: "Refund notification is not successful" };
  const result = settleProviderRefund(state, refund.id);
  return result.ok ? { ...result, idempotent: result.idempotent } : result;
}

function findOriginalPayment(state, refund) {
  return (state.paymentLedger || []).find(item => item.orderId === refund.orderId && item.direction === "in" && item.status === "paid" && item.amount > 0);
}

function findRefundByNotification(state, payload) {
  const merchantRefundNo = payload.mch_refund_no || payload.mch_refundno || payload.merchant_refund_no;
  const providerRefundNo = payload.refund_orderid || payload.refundid || payload.refund_no;
  const merchantOrderNo = payload.mch_orderid;
  return (state.refundOrders || []).find(item =>
    (merchantRefundNo && item.merchantRefundNo === merchantRefundNo)
    || (providerRefundNo && item.providerRefundNo === providerRefundNo)
    || (merchantOrderNo && item.providerMerchantOrderNo === merchantOrderNo)
  );
}

function validateProviderIdentity(refund, payload) {
  if (payload.mch_refund_no && refund.merchantRefundNo && payload.mch_refund_no !== refund.merchantRefundNo) throw new Error("refund identity mismatch");
  if (payload.mch_orderid && refund.providerMerchantOrderNo && payload.mch_orderid !== refund.providerMerchantOrderNo) throw new Error("payment identity mismatch");
  if (payload.orderid && refund.providerOrderNo && payload.orderid !== refund.providerOrderNo) throw new Error("provider order identity mismatch");
}

function providerCompleted(payload) {
  const value = String(payload.refundstatus ?? payload.refund_status ?? payload.refundStatus ?? payload.status ?? "").toUpperCase();
  return ["1", "SUCCESS", "REFUNDED", "REFUND_SUCCESS", "FINISHED"].includes(value);
}

function providerFailed(payload) {
  const value = String(payload.refundstatus ?? payload.refund_status ?? payload.refundStatus ?? payload.status ?? "").toUpperCase();
  return ["-1", "FAIL", "FAILED", "CLOSED", "CANCELLED"].includes(value);
}

function markRefundFailed(state, refund, reason) {
  refund.status = "failed";
  refund.providerErrorMessage = reason;
  refund.updatedAt = new Date().toISOString();
  saveState();
  return { ok: false, status: 502, error: reason, refundOrder: refund };
}

function sameAmount(left, right) {
  const cents = value => /^\d+(?:\.\d{1,2})?$/.test(String(value)) ? Math.round(Number(value) * 100) : null;
  return cents(left) !== null && cents(left) === cents(right);
}

module.exports = {
  prepareRefundApproval,
  submitRefund,
  queryRefund,
  handleRefundNotification
};
