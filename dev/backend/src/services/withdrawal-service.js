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
  if (["SUCCESS", "TRANSFER_SUCCESS", "FINISHED"].includes(status)) withdrawal.status = "success";
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
  return { ok: result.ok, status: result.ok ? 200 : 502, withdrawal: update(state, w, result.body || {}) , error: result.ok ? undefined : "服务商查询失败" };
}
function handleCallback(state, input) { const key = input.out_order_no || input.order_id || input.withdrawalId; const w = state.withdrawRequests.find((x) => x.id === key || x.providerOrderId === key); return w ? { ok: true, withdrawal: update(state, w, input, true) } : { ok: false, status: 404, error: "提现记录不存在" }; }
module.exports = { queryWithdrawal, submitWithdrawal, handleCallback };
