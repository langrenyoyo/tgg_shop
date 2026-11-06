const { saveState } = require("../data/store");
const huifu = require("./withdrawal-provider/huifu-bafang");
const userRepository = require("../repositories/user-repository");
const ledgerRepository = require("../repositories/ledger-repository");
const crypto = require("node:crypto");
const authorizationService = require("./huifu-authorization-service");
const operations = new Set();
async function exclusive(id, action) {
  if (operations.has(id)) return { ok: false, status: 409, error: "提现正在处理中，请稍后查询" };
  operations.add(id);
  try { return await action(); } finally { operations.delete(id); }
}
function resultStatus(data) {
  const status = String(data.transfer_state || data.error_code || data.status || data.tradeStatus || "").toUpperCase();
  // pay_status is authoritative for V3; contradictory terminal fields are rejected.
  if (data.pay_status !== undefined) {
    if (Number(data.pay_status) === 3) return ["FAIL", "FAILED", "CANCELLED", "OVERDUE_CLOSE"].includes(status) ? "UNKNOWN" : "SUCCESS";
    if (Number(data.pay_status) === 4) return status === "SUCCESS" ? "UNKNOWN" : "FAIL";
    if ([1, 2].includes(Number(data.pay_status))) return ["SUCCESS", "FAIL", "FAILED", "CANCELLED", "OVERDUE_CLOSE"].includes(status) ? "UNKNOWN" : status || "PROCESSING";
    return "UNKNOWN";
  }
  return status;
}
function providerOrderId(withdrawalId) {
  return `TGG${crypto.createHash("sha256").update(String(withdrawalId)).digest("hex").slice(0, 29)}`;
}
function update(state, withdrawal, body, callback = false) {
  const data = body.data || body.result || body;
  const status = resultStatus(data);
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
      ledgerRepository.addWithdrawableEntry(state, { id: `wlg_${Date.now()}_payout`, userId: user.id, changeType: "withdraw_payout", direction: "out", amount: withdrawal.arrivalAmount, balanceAfter: user.withdrawableBalance, bizNo: withdrawal.id, idempotencyKey: payoutKey, createdAt: withdrawal.lastQueryAt });
    }
    const fee = Number(withdrawal.fee || 0);
    const feeKey = `${withdrawal.id}:fee`;
    if (user && fee > 0 && !(state.withdrawableLedger || []).some(item => item.idempotencyKey === feeKey)) {
      ledgerRepository.addWithdrawableEntry(state, { id: `wlg_${Date.now()}_fee`, userId: withdrawal.userId, changeType: "withdraw_fee", direction: "out", amount: fee, balanceAfter: user.withdrawableBalance, bizNo: withdrawal.id, idempotencyKey: feeKey, createdAt: withdrawal.lastQueryAt });
    }
  }
  if (["FAIL", "FAILED", "CLOSED", "CANCELLED", "OVERDUE_CLOSE", "REFUND"].includes(status)) {
    withdrawal.status = "failed";
    const user = userRepository.findById(state, withdrawal.userId);
    if (user && !withdrawal.unfrozenAt && !(state.withdrawableLedger || []).some(item => item.idempotencyKey === `${withdrawal.id}:provider-failed`)) {
      user.withdrawableBalance = Math.round((user.withdrawableBalance + withdrawal.amount) * 100) / 100;
      withdrawal.unfrozenAt = withdrawal.lastQueryAt;
      ledgerRepository.addWithdrawableEntry(state, { id: `wlg_${Date.now()}`, userId: user.id, changeType: "withdraw_unfreeze", direction: "in", amount: withdrawal.amount, balanceAfter: user.withdrawableBalance, bizNo: withdrawal.id, idempotencyKey: `${withdrawal.id}:provider-failed` , createdAt: withdrawal.lastQueryAt });
    }
  }
  withdrawal.updatedAt = withdrawal.lastQueryAt; saveState(); return withdrawal;
}
function providerAmountMatches(withdrawal, body) {
  const data = body?.data || body?.result || body || {};
  const expectedCents = Math.round(Number(withdrawal.arrivalAmount ?? withdrawal.amount) * 100);
  let actualCents = null;
  if (data.amount_cents !== undefined || data.transfer_amount_cents !== undefined) {
    const raw = data.amount_cents ?? data.transfer_amount_cents;
    if (/^\d+$/.test(String(raw))) actualCents = Number(raw);
  } else if (data.amount !== undefined) {
    const raw = String(data.amount);
    if (/^\d+(?:\.\d{1,2})?$/.test(raw)) actualCents = Math.round(Number(raw) * 100);
  } else if (data.transfer_amount !== undefined) {
    if (/^\d+$/.test(String(data.transfer_amount))) actualCents = Number(data.transfer_amount);
  }
  return Number.isSafeInteger(actualCents) && actualCents >= 0 && actualCents === expectedCents;
}
async function submitWithdrawal(state, id) {
  const w = state.withdrawRequests.find((x) => x.id === id);
  if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  if (!["approved", "processing"].includes(w.status)) return { ok: false, status: 400, error: "提现单当前状态不可提交" };
  if (!huifu.isConfigured()) return { ok: false, status: 503, error: "汇服八方提现通道未配置" };
  // A prior send (including timeout) is reconciled, never blindly paid again.
  if (w.submission || w.submittedAt || w.status === "processing" || w.providerMerchantOrderId) return queryWithdrawal(state, id);
  const transferMode = huifu.transferMode(w);
  if (!["AUTH", "CONFIRM", "CONFIRM_AUTH"].includes(transferMode)) return { ok: false, status: 503, error: "提现模式配置无效，请联系管理员" };
  let authorization = null;
  if (transferMode === "AUTH") {
    const user = userRepository.findById(state, w.userId);
    const local = huifu.activeAuthorization(user);
    if (!local || local.openid !== w.openid || (w.authorizationNo && w.authorizationNo !== local.authorizationNo)) return { ok: false, status: 409, error: "微信收款授权无效，请重新授权" };
    const checked = await authorizationService.statusForUser(state, user);
    if (!checked.ok || checked.status !== "active") return { ok: false, status: checked.ok ? 409 : checked.status, error: checked.error || "微信收款授权已失效" };
    authorization = huifu.activeAuthorization(user);
    if (!authorization || authorization.openid !== w.openid
      || (w.authorizationNo && w.authorizationNo !== authorization.authorizationNo)
      || (w.status === "processing" && !w.authorizationNo)) {
      return { ok: false, status: 409, error: "微信收款授权无效、已失效或与提现单不匹配，请重新授权后再处理" };
    }
  }
  const appid = process.env.HF_WECHAT_APPID || process.env.WECHAT_APPID;
  const merchantOrderId = w.providerMerchantOrderId || providerOrderId(w.id);
  const amountCents = Math.round(Number(w.arrivalAmount ?? w.amount) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 10 || amountCents > 20000) return { ok: false, status: 400, error: "渠道单笔到账金额须在 0.1 至 200 元之间" };
  // Persist the mode, authorization and stable provider key before the request,
  // including an uncertain request that may have reached the provider.
  w.transferMode = transferMode;
  if (authorization) w.authorizationNo = authorization.authorizationNo;
  w.providerMerchantOrderId = merchantOrderId;
  w.submittedAt = new Date().toISOString();
  w.submission = { orderId: merchantOrderId, merchantId: process.env.HF_MERCHANT_ID, appid, openid: w.openid, amountCents,
    transferMode, authorizationNo: w.authorizationNo || null, submittedAt: w.submittedAt };
  w.status = "processing";
  w.providerStatus = "SUBMITTING";
  await saveState();
  let result;
  try { result = await huifu.submit({
    merchant_id: process.env.HF_MERCHANT_ID,
    appid,
    order_id: merchantOrderId,
    openid: w.openid,
    transfer_amount: amountCents,
    remark: String(w.remark || `TGG提现${w.id}`).slice(0, 32),
    user_recv_perception: process.env.HF_USER_RECV_PERCEPTION || "现金奖励",
    callback_url: process.env.HF_CALLBACK_URL,
    transfer_mode: transferMode,
    authorization_no: w.authorizationNo || undefined,
    user_display_name: w.recipientName || w.userDisplayName || "TGG用户",
    authorization_notify_url: process.env.HF_AUTHORIZATION_CALLBACK_URL,
    user_recv_type: process.env.HF_USER_RECV_TYPE || "CONFIRM_PAGE"
  }, process.env); } catch {
    w.providerStatus = "UNKNOWN";
    await saveState();
    return { ok: false, status: 502, error: "提交结果暂未确认，请查询原提现单，勿重复付款" };
  }
  if (!result.ok) {
    w.providerStatus = "SUBMIT_UNCONFIRMED";
    w.providerErrorCode = Number.isInteger(Number(result.body?.code)) ? String(result.body.code) : null;
    await saveState();
    return {
      ok: false,
      status: 502,
      error: "服务商未确认受理，请查询原提现单后处理",
      providerStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : undefined
    };
  }
  w.status = "processing"; w.providerStatus = "PROCESSING"; w.updatedAt = new Date().toISOString();
  const data = result.body?.data || result.body?.result || result.body || {};
  if (data.order_id && data.order_id !== merchantOrderId) return { ok: false, status: 502, error: "服务商返回单号不匹配，请核对原提现单" };
  w.providerMerchantOrderId = data.order_id || merchantOrderId;
  w.providerOrderId = data.platform_order_id || data.batch_no || w.providerOrderId;
  w.transferPackage = data.package_info || null;
  w.transferState = data.transfer_state || data.error_code || null;
  saveState(); return { ok: true, withdrawal: w };
}
async function queryWithdrawal(state, id) {
  const w = state.withdrawRequests.find((x) => x.id === id); if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  if (!huifu.isConfigured()) return { ok: false, status: 503, error: "汇服八方提现通道未配置" };
  if (!w.providerOrderId && !Number.isFinite(Date.parse(w.submittedAt || w.createdAt))) return { ok: false, status: 409, error: "历史提现缺少提交日期，请人工核对" };
  let result;
  try { result = await huifu.query(w.providerOrderId
    ? { platform_order_id: w.providerOrderId }
    : { order_id: w.providerMerchantOrderId || providerOrderId(w.id), order_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(w.submittedAt || w.createdAt)) }, process.env); }
  catch { return { ok: false, status: 502, error: "服务商查询暂不可用，请稍后重试" }; }
  if (!result.ok) return { ok: false, status: 502, error: "服务商查询失败" };
  const body = result.body || {};
  const data = body.data || body.result || body;
  if (!data.order_id || data.order_id !== (w.providerMerchantOrderId || providerOrderId(w.id)) || !data.platform_order_id || (w.providerOrderId && data.platform_order_id !== w.providerOrderId)) return { ok: false, status: 409, error: "服务商查询单号与提现单不一致" };
  const status = resultStatus(data);
  const terminal = ["SUCCESS", "RECEIVED", "FAIL", "FAILED", "CLOSED", "CANCELLED", "OVERDUE_CLOSE", "REFUND"].includes(status);
  if (!terminal && !["ACCEPTED", "PROCESSING", "WAIT_USER_CONFIRM", "TRANSFERING", "CANCELING", "SENDING", "SENT", "RFUND_ING", "PENDING", "WAIT", "IN_PROGRESS"].includes(status)) return { ok: false, status: 502, error: "服务商查询返回未知状态" };
  if (terminal) {
    const snapshot = w.submission;
    const trusted = snapshot && snapshot.orderId === data.order_id && snapshot.openid === w.openid
      && snapshot.merchantId === process.env.HF_MERCHANT_ID && snapshot.appid === (process.env.HF_WECHAT_APPID || process.env.WECHAT_APPID)
      && snapshot.amountCents === Math.round(Number(w.arrivalAmount ?? w.amount) * 100)
      && snapshot.transferMode === w.transferMode && snapshot.authorizationNo === (w.authorizationNo || null);
    const hasAmount = ["amount", "amount_cents", "transfer_amount", "transfer_amount_cents"].some(key => data[key] !== undefined);
    // V3 query omits amount: use only our durable pre-send snapshot, never client/callback amounts.
    const settled = handleCallback(state, { ...data, ...(!hasAmount && trusted ? { amount_cents: snapshot.amountCents } : {}) });
    return settled.ok ? { ...settled, status: 200 } : settled;
  }
  if (["success", "failed", "rejected", "cancelled"].includes(w.status)) return { ok: true, withdrawal: w, idempotent: true };
  return { ok: true, status: 200, withdrawal: update(state, w, body) };
}
function handleCallback(state, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, status: 400, error: "提现回调格式错误" };
  const key = input.out_order_no || input.order_id || input.withdrawalId;
  if (key == null || String(key).trim() === "") return { ok: false, status: 400, error: "提现回调缺少业务单号" };
  const w = state.withdrawRequests.find((x) => x.id === key || x.providerOrderId === key || x.providerMerchantOrderId === key);
  if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  const data = input.data || input.result || input;
  const providerStatus = resultStatus(data);
  const success = ["SUCCESS", "RECEIVED", "TRANSFER_SUCCESS", "FINISHED"].includes(providerStatus);
  const failed = ["FAIL", "FAILED", "CLOSED", "CANCELLED", "OVERDUE_CLOSE", "REFUND"].includes(providerStatus);
  if (!success && !failed) return { ok: false, status: 502, error: "服务商提现状态未知" };
  if (w.status === "success") return success ? { ok: true, withdrawal: w, idempotent: true } : { ok: false, status: 409, error: "提现已成功，拒绝逆向失败回调" };
  if (w.status === "failed" || w.status === "rejected") return failed ? { ok: true, withdrawal: w, idempotent: true } : { ok: false, status: 409, error: "提现已失败，拒绝逆向成功回调" };
  if (w.status === "pending_review") return { ok: false, status: 409, error: "提现尚未完成审批，拒绝服务商回调" };
  if (success) {
    if (!providerAmountMatches(w, input)) return { ok: false, status: 409, error: "服务商提现金额与本地提现单不一致" };
    const payout = (state.withdrawableLedger || []).find(item => item.idempotencyKey === `${w.id}:payout`);
    const expectedPayout = Number(w.arrivalAmount ?? w.amount);
    if (payout && (payout.userId !== w.userId || Number(payout.amount) !== expectedPayout || payout.bizNo !== w.id || payout.direction !== "out")) return { ok: false, status: 409, error: "提现出账流水与提现单不一致，请人工核对" };
    const fee = Number(w.fee || 0);
    const feeEntry = (state.withdrawableLedger || []).find(item => item.idempotencyKey === `${w.id}:fee`);
    if (fee > 0 && feeEntry && (feeEntry.userId !== w.userId || Number(feeEntry.amount) !== fee || feeEntry.bizNo !== w.id || feeEntry.direction !== "out")) return { ok: false, status: 409, error: "提现手续费流水冲突，请人工核对" };
  }
  return { ok: true, withdrawal: update(state, w, input, true) };
}
async function reconcileCallback(state, data) {
  if (data?.notify_type !== "wx_transfer" || !data.order_id || !data.platform_order_id) return { ok: false, status: 400, error: "提现通知类型或单号无效" };
  const w = state.withdrawRequests.find(item => item.providerMerchantOrderId === data.order_id);
  if (!w) return { ok: false, status: 404, error: "提现记录不存在" };
  if (w.providerOrderId && w.providerOrderId !== data.platform_order_id) return { ok: false, status: 409, error: "提现通知单号不匹配" };
  return exclusive(w.id, () => queryWithdrawal(state, w.id));
}
module.exports = {
  queryWithdrawal: (state, id) => exclusive(id, () => queryWithdrawal(state, id)),
  submitWithdrawal: (state, id) => exclusive(id, () => submitWithdrawal(state, id)),
  handleCallback, reconcileCallback
};
