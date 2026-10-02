const { saveState, nextId } = require("../data/store");
const paymentService = require("./payment-service");
const userRepository = require("../repositories/user-repository");
const ledgerRepository = require("../repositories/ledger-repository");

function enabled(env = process.env) {
  return env.NODE_ENV !== "production" && String(env.TGG_TEST_BYPASS_ENABLED || "") === "1";
}

function settlePayment(state, user, payNo) {
  const payment = state.paymentLedger.find(item => (item.payNo === payNo || item.id === payNo) && item.userId === user.id);
  if (!payment) return { ok: false, status: 404, error: "支付单不存在" };
  const result = paymentService.mockPaymentCallback(state, payment.payNo, { status: "paid", thirdTradeNo: `TEST_${payment.payNo}` });
  return result.ok ? { ok: true, payment: result.payment, result: result.result, testBypass: true, idempotent: result.idempotent } : result;
}

function completeWithdrawal(state, user, withdrawalId) {
  const withdrawal = state.withdrawRequests.find(item => item.id === withdrawalId && item.userId === user.id);
  if (!withdrawal) return { ok: false, status: 404, error: "提现记录不存在" };
  if (withdrawal.status === "success") return { ok: true, withdrawal, testBypass: true, idempotent: true };
  if (!["pending_review", "approved", "processing"].includes(withdrawal.status)) return { ok: false, status: 409, error: "提现单当前状态不能使用测试完成" };
  const now = new Date().toISOString();
  const payoutKey = `${withdrawal.id}:payout`;
  withdrawal.status = "success";
  withdrawal.providerStatus = "TEST_SUCCESS";
  withdrawal.transferState = "TEST_SUCCESS";
  withdrawal.providerMerchantOrderId ||= `TEST_${withdrawal.id}`;
  withdrawal.updatedAt = now;
  withdrawal.callbackAt = now;
  if (!(state.withdrawableLedger || []).some(item => item.idempotencyKey === payoutKey)) {
    const owner = userRepository.findById(state, withdrawal.userId);
    ledgerRepository.addWithdrawableEntry(state, {
      id: nextId("wlg"),
      userId: withdrawal.userId,
      changeType: "withdraw_payout",
      direction: "out",
      amount: withdrawal.amount,
      balanceAfter: owner?.withdrawableBalance || 0,
      bizNo: withdrawal.id,
      idempotencyKey: payoutKey,
      createdAt: now
    });
  }
  saveState();
  return { ok: true, withdrawal, testBypass: true, idempotent: false };
}

module.exports = { enabled, settlePayment, completeWithdrawal };
