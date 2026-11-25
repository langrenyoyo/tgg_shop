const crypto = require("node:crypto");
const { nextId, saveState } = require("../data/store");
const { createException } = require("../domain/exception-rules");
const { settleProviderRefund } = require("../domain/refund-rules");
const { createLfwinClient } = require("./lfwin-payment-client");
const refundRepository = require("../repositories/refund-repository");
const { exclusive } = require("./operation-lock");
const { resolveException } = require("../domain/exception-rules");

function createMerchantRefundNo() {
  return `RFD${Date.now()}${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

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
  refund.merchantRefundNo ||= createMerchantRefundNo();
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
  return exclusive(refund, () => submitRefundOwned(state, refundId, options, client));
}

async function submitRefundOwned(state, refundId, options, client) {
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
  refund.merchantRefundNo ||= createMerchantRefundNo();
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
    if (refund.status === "refunded") return finishRefund(state, refund);
    validateProviderIdentity(refund, response);
    if (response.refundmoney !== undefined && !sameAmount(refund.refundCashAmount, response.refundmoney)) {
      throw new Error("Provider refund amount mismatch");
    }
    refund.providerRefundNo = response.refund_orderid || response.refundid || response.refund_no || response.refundNo || null;
    refund.providerStatus = String(response.refundstatus || response.refund_status || response.status || "10000");
    // Request acceptance (10000/4001) is not a completed cash refund.
    refund.status = "refunding";
    refund.submittedAt ||= new Date().toISOString();
    refund.updatedAt = new Date().toISOString();
    refund.providerErrorMessage = "";
    resolveUncertainExceptions(state, refund);
    await saveState();
    return { ok: true, refundOrder: refund, provider: publicRefundProvider(response), awaitingProvider: true };
  } catch (error) {
    if (refund.status === "refunded") return finishRefund(state, refund);
    refund.status = "unknown";
    refund.updatedAt = new Date().toISOString();
    createException(state, {
      type: "refund_initiation_uncertain",
      bizNo: refund.id,
      action: "查询服务商退款结果，不得自动重复发起",
      payload: { refundId: refund.id, merchantRefundNo: refund.merchantRefundNo, error: "provider_error" }
    });
    await saveState();
    return { ok: false, status: 502, error: "退款发起结果未知，请查询服务商结果" };
  }
}

async function queryRefund(state, refundId, client = createLfwinClient()) {
  const refund = refundRepository.findById(state, refundId);
  if (!refund) return { ok: false, status: 404, error: "退款单不存在" };
  return exclusive(refund, () => queryRefundOwned(state, refundId, client));
}

async function queryRefundOwned(state, refundId, client) {
  const refund = refundRepository.findById(state, refundId);
  if (!refund) return { ok: false, status: 404, error: "退款单不存在" };
  if (refund.status === "refunded") return finishRefund(state, refund);
  if (!["unknown", "refunding", "approved", "sending"].includes(refund.status)) return { ok: false, status: 400, error: "当前退款单不可查询服务商" };
  const payment = findOriginalPayment(state, refund);
  if (!payment?.metadata?.lfwin?.providerOrderNo) return { ok: false, status: 503, error: "原支付单没有可验证的服务商订单" };
  refund.lastQueryAt = new Date().toISOString();
  try {
    const envelope = await client.queryRefund({
      providerOrderNo: payment.metadata.lfwin.providerOrderNo,
      merchantOrderNo: payment.payNo,
      merchantRefundNo: refund.merchantRefundNo,
      providerRefundNo: refund.providerRefundNo,
      orderTime: payment.createdAt
    });
    if (refund.status === "refunded") return finishRefund(state, refund);
    const response = refundResult(refund, envelope);
    validateProviderIdentity(refund, response);
    if (response.refundmoney !== undefined && !sameAmount(refund.refundCashAmount, response.refundmoney)) throw new Error("Provider refund amount mismatch");
    refund.providerRefundNo ||= response.refund_orderid || response.refundid || response.refund_no || null;
    refund.providerStatus = String(response.refundstatus || response.refund_status || response.status || "");
    if (providerCompleted(response)) {
      if (!sameAmount(refund.refundCashAmount, response.refundmoney)) throw new Error("Missing verified refund amount");
      const result = finishRefund(state, refund);
      return result.ok ? { ...result, provider: publicRefundProvider(response) } : result;
    }
    if (providerFailed(response)) return markRefundFailed(state, refund, "服务商拒绝退款");
    refund.status = "refunding";
    refund.providerErrorMessage = "";
    resolveUncertainExceptions(state, refund);
    refund.lastQueryAt = new Date().toISOString();
    refund.updatedAt = refund.lastQueryAt;
    await saveState();
    return { ok: true, refundOrder: refund, provider: publicRefundProvider(response), awaitingProvider: true };
  } catch {
    if (refund.status === "refunded") return finishRefund(state, refund);
    await saveState();
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
  if (!sameAmount(refund.refundCashAmount, payload.refundmoney)) return { ok: false, status: 400, error: "Missing refund amount" };
  refund.providerRefundNo ||= payload.refund_orderid || payload.refundid || payload.refund_no || null;
  refund.providerStatus = String(payload.refundstatus ?? payload.refund_status ?? payload.status ?? "");
  const result = finishRefund(state, refund);
  return result.ok ? { ...result, idempotent: result.idempotent } : result;
}

function refundResult(refund, envelope) {
  if (!Array.isArray(envelope.lists)) {
    if (String(envelope.status) === "4001") return envelope;
    if (envelope.orderid !== refund.providerOrderNo || (envelope.mch_refund_no !== refund.merchantRefundNo
      && !(refund.providerRefundNo && (envelope.refund_no || envelope.refund_orderid) === refund.providerRefundNo))) throw new Error("Provider refund identity missing");
    return envelope;
  }
  const matches = envelope.lists.filter(row => row && typeof row === "object"
    && row.mch_refund_no === refund.merchantRefundNo
    && row.orderid === refund.providerOrderNo
    && (!refund.providerRefundNo || (row.refund_no || row.refund_orderid) === refund.providerRefundNo));
  if (matches.length !== 1) throw new Error("No unique matching provider refund");
  return matches[0];
}

function resolveUncertainExceptions(state, refund) {
  for (const exception of state.exceptions || []) {
    if (exception.type === "refund_initiation_uncertain" && exception.bizNo === refund.id && exception.status !== "resolved") {
      resolveException(state, exception.id, refund.status === "refunded" ? "服务商已确认退款成功，原发起结果异常已核对" : "服务商已受理退款，等待最终退款结果");
    }
  }
}

function finishRefund(state, refund) {
  const result = settleProviderRefund(state, refund.id);
  if (result.ok) { refund.providerErrorMessage = ""; resolveUncertainExceptions(state, refund); saveState(); }
  return result;
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
  return ["2", "-1", "FAIL", "FAILED", "CLOSED", "CANCELLED"].includes(value);
}

function publicRefundProvider(response = {}) {
  return {
    status: response.refundstatus ?? response.refund_status ?? response.status ?? null,
    orderId: response.orderid || null,
    merchantRefundNo: response.mch_refund_no || null,
    refundOrderId: response.refund_orderid || response.refundid || response.refund_no || response.refundNo || null,
    amount: response.refundmoney ?? null
  };
}

function markRefundFailed(state, refund, reason) {
  if (refund.status === "refunded") return { ok: false, status: 409, error: "已成功退款，不能回退为失败" };
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

function createWorker({ state = () => require("../data/store").getState(), client = createLfwinClient(), now = () => Date.now() } = {}) {
  let running = null, stopped = false;
  async function run() {
    if (stopped || (typeof client.isConfigured === "function" && !client.isConfigured())) return;
    const current = state();
    // Close stale alerts left by old versions, using the already settled ledger.
    let cleaned = false;
    for (const refund of current.refundOrders || []) {
      if (refund.status === "refunded" && current.paymentLedger.some(entry => entry.idempotencyKey === `refund:${refund.id}:cash`)
        && (current.exceptions || []).some(e => e.bizNo === refund.id && e.type === "refund_initiation_uncertain" && e.status !== "resolved")) {
        resolveUncertainExceptions(current, refund); cleaned = true;
      }
    }
    if (cleaned) await saveState();
    const pending = (current.refundOrders || []).filter(refund => refund.refundCashAmount > 0 && refund.merchantRefundNo
      && ["unknown", "sending", "refunding"].includes(refund.status)
      && now() - Date.parse(refund.lastQueryAt || refund.submittedAt || refund.updatedAt || refund.createdAt) >= 60000)
      .sort((a,b) => Date.parse(a.lastQueryAt || a.updatedAt) - Date.parse(b.lastQueryAt || b.updatedAt)).slice(0,3);
    for (const refund of pending) {
      if (stopped) break;
      await queryRefund(current, refund.id, client);
    }
  }
  return {
    run() { if (!running) running = run().finally(() => { running = null; }); return running; },
    async stop() { stopped = true; if (running) await running; }
  };
}

module.exports = {
  prepareRefundApproval,
  submitRefund,
  queryRefund,
  handleRefundNotification,
  createWorker
};
