const { saveState } = require("../data/store");
const huifu = require("./withdrawal-provider/huifu-bafang");
const userRepository = require("../repositories/user-repository");
const ledgerRepository = require("../repositories/ledger-repository");
function update(state, withdrawal, body, callback = false) {
  const data = body.data || body.result || body;
  const status = String(data.status || data.transfer_state || data.tradeStatus || "").toUpperCase();
  withdrawal.providerStatus = status || "UNKNOWN";
  withdrawal.providerOrderId = data.order_id || data.out_order_no || data.batch_no || withdrawal.providerOrderId;
  withdrawal.providerErrorCode = body.code && String(body.code) !== "200" ? String(body.code) : null;
  withdrawal.providerErrorMessage = body.message || body.msg || null;
  withdrawal.lastQueryAt = new Date().toISOString();
  if (callback) withdrawal.callbackAt = withdrawal.lastQueryAt;
  if (["SUCCESS", "TRANSFER_SUCCESS", "FINISHED"].includes(status)) {
    withdrawal.status = "success";
    const user = userRepository.findById(state, withdrawal.userId);
    const payoutKey = `${withdrawal.id}:payout`;
    if (user && !(state.withdrawableLedger || []).some(item => item.idempotencyKey === payoutKey)) {
      ledgerRepository.addWithdrawableEntry(state, { id: `wlg_${Date.now()}_payout`, userId: user.id, changeType: "withdraw_payout", direction: "out", amount: withdrawal.amount, balanceAfter: user.withdrawableBalance, bizNo: withdrawal.id, idempotencyKey: payoutKey, createdAt: withdrawal.lastQueryAt });
    }
  }
  if (["FAIL", "FAILED", "CLOSED", "CANCELLED"].includes(status)) {
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
  const result = await huifu.submit({ out_order_no: w.id, amount: Math.round(w.amount * 100), openid: w.openid, recipient_name: w.recipientName }, process.env);
  if (!result.ok) return { ok: false, status: 502, error: "服务商提交失败", detail: result.body };
  w.status = "processing"; w.providerStatus = "PROCESSING"; w.submittedAt = new Date().toISOString(); w.updatedAt = w.submittedAt;
  const data = result.body?.data || result.body?.result || result.body || {};
  w.providerOrderId = data.order_id || data.out_order_no || data.batch_no || w.providerOrderId;
  saveState(); return { ok: true, withdrawal: w };
}
async function queryWithdrawal(state, id) {
  const w = state.withdrawRequests.find((x) => x.id === id); if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  if (!huifu.isConfigured()) return { ok: false, status: 503, error: "汇服八方提现通道未配置" };
  const result = await huifu.query({ out_order_no: w.id, provider_order_id: w.providerOrderId }, process.env);
  if (!result.ok) return { ok: false, status: 502, error: "服务商查询失败" };
  const body = result.body || {};
  const data = body.data || body.result || body;
  const status = String(data.status || data.transfer_state || data.tradeStatus || "").toUpperCase();
  const terminal = ["SUCCESS", "TRANSFER_SUCCESS", "FINISHED", "FAIL", "FAILED", "CLOSED", "CANCELLED"].includes(status);
  if (!terminal && !["PROCESSING", "PENDING", "WAIT", "IN_PROGRESS"].includes(status)) return { ok: false, status: 502, error: "服务商查询返回未知状态" };
  if (terminal) {
    const settled = handleCallback(state, { ...body, out_order_no: w.id });
    return settled.ok ? { ...settled, status: 200 } : settled;
  }
  return { ok: true, status: 200, withdrawal: update(state, w, body) };
}
function handleCallback(state, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, status: 400, error: "提现回调格式错误" };
  const key = input.out_order_no || input.order_id || input.withdrawalId;
  if (key == null || String(key).trim() === "") return { ok: false, status: 400, error: "提现回调缺少业务单号" };
  const w = state.withdrawRequests.find((x) => x.id === key || x.providerOrderId === key);
  if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  const data = input.data || input.result || input;
  const providerStatus = String(data.status || data.transfer_state || data.tradeStatus || "").toUpperCase();
  const success = ["SUCCESS", "TRANSFER_SUCCESS", "FINISHED"].includes(providerStatus);
  const failed = ["FAIL", "FAILED", "CLOSED", "CANCELLED"].includes(providerStatus);
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
