const { saveState } = require("../data/store");
const huifu = require("./withdrawal-provider/huifu-bafang");
const userRepository = require("../repositories/user-repository");
const ledgerRepository = require("../repositories/ledger-repository");
const crypto = require("node:crypto");
function providerOrderId(withdrawalId) {
  return `TGG${crypto.createHash("sha256").update(String(withdrawalId)).digest("hex").slice(0, 29)}`;
}
function update(state, withdrawal, body, callback = false) {
  const data = body.data || body.result || body;
  const status = String(data.transfer_state || data.error_code || data.status || data.tradeStatus || "").toUpperCase();
  withdrawal.providerStatus = status || "UNKNOWN";
  withdrawal.providerMerchantOrderId = data.order_id || data.out_order_no || withdrawal.providerMerchantOrderId;
  withdrawal.providerOrderId = data.platform_order_id || data.batch_no || withdrawal.providerOrderId;
  withdrawal.providerResultCode = data.result_code || withdrawal.providerResultCode || null;
  withdrawal.providerErrorCode = body.code && String(body.code) !== "200" ? String(body.code) : null;
  withdrawal.providerErrorMessage = data.error_msg || body.message || body.msg || null;
  withdrawal.transferPackage = data.package_info || withdrawal.transferPackage || null;
  withdrawal.transferState = status || withdrawal.transferState || null;
  withdrawal.lastQueryAt = new Date().toISOString();
  if (callback) withdrawal.callbackAt = withdrawal.lastQueryAt;
  if (["SUCCESS", "RECEIVED", "TRANSFER_SUCCESS", "FINISHED"].includes(status)) {
    withdrawal.status = "success";
    const user = userRepository.findById(state, withdrawal.userId);
    const payoutKey = `${withdrawal.id}:payout`;
    if (user && !(state.withdrawableLedger || []).some(item => item.idempotencyKey === payoutKey)) {
      ledgerRepository.addWithdrawableEntry(state, { id: `wlg_${Date.now()}_payout`, userId: user.id, changeType: "withdraw_payout", direction: "out", amount: withdrawal.amount, balanceAfter: user.withdrawableBalance, bizNo: withdrawal.id, idempotencyKey: payoutKey, createdAt: withdrawal.lastQueryAt });
    }
  }
  if (["FAIL", "FAILED", "CLOSED", "CANCELLED", "OVERDUE_CLOSE", "REFUND"].includes(status)) {
    withdrawal.status = "failed";
    const user = userRepository.findById(state, withdrawal.userId);
    if (user && !withdrawal.unfrozenAt) {
      user.withdrawableBalance = Math.round((user.withdrawableBalance + withdrawal.amount) * 100) / 100;
      withdrawal.unfrozenAt = withdrawal.lastQueryAt;
      ledgerRepository.addWithdrawableEntry(state, { id: `wlg_${Date.now()}`, userId: user.id, changeType: "withdraw_unfreeze", direction: "in", amount: withdrawal.amount, balanceAfter: user.withdrawableBalance, bizNo: withdrawal.id, idempotencyKey: `${withdrawal.id}:provider-failed` , createdAt: withdrawal.lastQueryAt });
    }
  }
  withdrawal.updatedAt = withdrawal.lastQueryAt; saveState(); return withdrawal;
}
function providerAmountMatches(withdrawal, body) {
  const data = body?.data || body?.result || body || {};
  const raw = data.amount ?? data.transfer_amount ?? data.amount_cents;
  if (raw === undefined || raw === null || raw === "") return true;
  const number = Number(raw);
  // amount_cents is explicitly cents; other provider amount fields are yuan.
  const amount = data.amount_cents !== undefined ? number / 100 : number;
  return Number.isFinite(amount) && Math.abs(amount - Number(withdrawal.amount)) < 0.005;
}
async function submitWithdrawal(state, id) {
  const w = state.withdrawRequests.find((x) => x.id === id);
  if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  if (!["approved", "processing"].includes(w.status)) return { ok: false, status: 400, error: "提现单当前状态不可提交" };
  if (!huifu.isConfigured()) return { ok: false, status: 503, error: "汇服八方提现通道未配置" };
  const appid = process.env.HF_WECHAT_APPID || process.env.WECHAT_APPID;
  const merchantOrderId = w.providerMerchantOrderId || providerOrderId(w.id);
  const result = await huifu.submit({
    merchant_id: process.env.HF_MERCHANT_ID,
    appid,
    order_id: merchantOrderId,
    openid: w.openid,
    transfer_amount: Math.round(w.amount * 100),
    remark: String(w.remark || `TGG提现${w.id}`).slice(0, 32),
    user_recv_perception: process.env.HF_USER_RECV_PERCEPTION || "现金奖励",
    callback_url: process.env.HF_CALLBACK_URL,
    transfer_mode: w.transferMode || process.env.HF_TRANSFER_MODE || "CONFIRM",
    authorization_no: w.authorizationNo,
    user_display_name: w.recipientName || w.userDisplayName || "TGG用户",
    authorization_notify_url: process.env.HF_AUTHORIZATION_NOTIFY_URL,
    user_recv_type: process.env.HF_USER_RECV_TYPE || "CONFIRM_PAGE"
  }, process.env);
  if (!result.ok) return { ok: false, status: 502, error: "服务商提交失败", detail: result.body };
  w.status = "processing"; w.providerStatus = "PROCESSING"; w.submittedAt = new Date().toISOString(); w.updatedAt = w.submittedAt;
  const data = result.body?.data || result.body?.result || result.body || {};
  w.providerMerchantOrderId = data.order_id || merchantOrderId;
  w.providerOrderId = data.platform_order_id || data.batch_no || w.providerOrderId;
  w.transferPackage = data.package_info || null;
  w.transferState = data.transfer_state || data.error_code || null;
  saveState(); return { ok: true, withdrawal: w };
}
async function queryWithdrawal(state, id) {
  const w = state.withdrawRequests.find((x) => x.id === id); if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  if (!huifu.isConfigured()) return { ok: false, status: 503, error: "汇服八方提现通道未配置" };
  const result = await huifu.query(w.providerOrderId
    ? { platform_order_id: w.providerOrderId }
    : { order_id: w.providerMerchantOrderId || providerOrderId(w.id), order_date: String(w.createdAt || "").slice(0, 10) }, process.env);
  if (!result.ok) return { ok: false, status: 502, error: "服务商查询失败" };
  const body = result.body || {};
  const data = body.data || body.result || body;
  const status = String(data.transfer_state || data.error_code || data.status || data.tradeStatus || "").toUpperCase();
  const terminal = ["SUCCESS", "RECEIVED", "FAIL", "FAILED", "CLOSED", "CANCELLED", "OVERDUE_CLOSE", "REFUND"].includes(status);
  if (!terminal && !["ACCEPTED", "PROCESSING", "WAIT_USER_CONFIRM", "TRANSFERING", "CANCELING", "SENDING", "SENT", "RFUND_ING", "PENDING", "WAIT", "IN_PROGRESS"].includes(status)) return { ok: false, status: 502, error: "服务商查询返回未知状态" };
  if (terminal) {
    const settled = handleCallback(state, { ...body, order_id: data.order_id || w.providerMerchantOrderId || providerOrderId(w.id) });
    return settled.ok ? { ...settled, status: 200 } : settled;
  }
  return { ok: true, status: 200, withdrawal: update(state, w, body) };
}
function handleCallback(state, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, status: 400, error: "提现回调格式错误" };
  const key = input.out_order_no || input.order_id || input.withdrawalId;
  if (key == null || String(key).trim() === "") return { ok: false, status: 400, error: "提现回调缺少业务单号" };
  const w = state.withdrawRequests.find((x) => x.id === key || x.providerOrderId === key || x.providerMerchantOrderId === key);
  if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  const data = input.data || input.result || input;
  const providerStatus = String(data.transfer_state || data.error_code || data.status || data.tradeStatus || "").toUpperCase();
  const success = ["SUCCESS", "RECEIVED", "TRANSFER_SUCCESS", "FINISHED"].includes(providerStatus);
  const failed = ["FAIL", "FAILED", "CLOSED", "CANCELLED", "OVERDUE_CLOSE", "REFUND"].includes(providerStatus);
  if (!success && !failed) return { ok: false, status: 502, error: "服务商提现状态未知" };
  if (w.status === "success") return success ? { ok: true, withdrawal: w, idempotent: true } : { ok: false, status: 409, error: "提现已成功，拒绝逆向失败回调" };
  if (w.status === "failed" || w.status === "rejected") return failed ? { ok: true, withdrawal: w, idempotent: true } : { ok: false, status: 409, error: "提现已失败，拒绝逆向成功回调" };
  if (w.status === "pending_review") return { ok: false, status: 409, error: "提现尚未完成审批，拒绝服务商回调" };
  if (success) {
    if (!providerAmountMatches(w, input)) return { ok: false, status: 409, error: "服务商提现金额与本地提现单不一致" };
    const payout = (state.withdrawableLedger || []).find(item => item.idempotencyKey === `${w.id}:payout`);
    if (payout && (payout.userId !== w.userId || payout.amount !== w.amount || payout.bizNo !== w.id || payout.direction !== "out")) return { ok: false, status: 409, error: "提现出账流水与提现单不一致，请人工核对" };
  }
  return { ok: true, withdrawal: update(state, w, input, true) };
}
module.exports = { queryWithdrawal, submitWithdrawal, handleCallback };
