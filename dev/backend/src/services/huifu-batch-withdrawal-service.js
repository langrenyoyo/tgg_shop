const crypto = require("node:crypto");
const { saveState } = require("../data/store");
const huifu = require("./withdrawal-provider/huifu-bafang");
const authorization = require("./huifu-authorization-service");
const failure = (error, status = 502) => ({ ok: false, status, error });
function chinaTime(value) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
async function submit(state, w) {
  const user = state.users.find(item => item.id === w.userId);
  if (!user || w.openid !== String(user.wechatOpenid || user.openid || "").trim()) return failure("收款微信与提现单不匹配", 409);
  const env = { ...process.env, HF_TRANSFER_MODE: "OAUTH" };
  const checked = await authorization.statusForUser(state, user, env);
  if (!checked.ok || checked.status !== "active") return failure(checked.error || "请先完成微信收款授权", checked.ok ? 409 : checked.status);
  const auth = huifu.activeAuthorization(user, env);
  if (!auth) return failure("微信收款授权无效", 409);
  const amountCents = Math.round(Number(w.arrivalAmount ?? w.amount) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 10 || amountCents > 50000) return failure("渠道单笔到账金额须在 0.1 至 500 元之间", 400);
  const digest = crypto.createHash("sha256").update(String(w.id)).digest("hex").slice(0, 29);
  const submittedAt = new Date().toISOString(), orderTime = chinaTime(submittedAt);
  const snapshot = { protocol: "OAUTH", transferMode: "OAUTH", batchNo: `TGB${digest}`, orderId: `TGD${digest}`,
    month: orderTime.slice(0, 7).replace("-", ""), orderTime, merchantId: auth.merchantId, appid: auth.appid,
    account: auth.account, openid: w.openid, amountCents, submittedAt };
  w.transferMode = "OAUTH";
  w.submission = snapshot;
  w.providerMerchantOrderId = snapshot.orderId;
  w.submittedAt = submittedAt;
  w.status = "processing";
  w.providerStatus = "SUBMITTING";
  await saveState();
  let result;
  try {
    result = await huifu.batchSubmit({ batch_no: snapshot.batchNo, order_time: snapshot.orderTime,
      merchant_id: snapshot.merchantId, appid: snapshot.appid, batch_name: "余额提现", batch_remark: "余额提现",
      total_amount: amountCents, total_num: 1,
      details: [{ order_id: snapshot.orderId, openid: snapshot.account, transfer_amount: amountCents, transfer_remark: "余额提现" }] });
  } catch {
    w.providerStatus = "UNKNOWN";
    await saveState();
    return failure("提交结果暂未确认，请查询原提现单，勿重复付款");
  }
  const data = result.body?.data;
  if (!result.ok || !data || data.batch_no !== snapshot.batchNo || !data.out_batch_no || !/^\d{6}$/.test(data.month || "")) {
    w.providerStatus = "SUBMIT_UNCONFIRMED";
    w.providerErrorCode = /^\d+$/.test(String(result.body?.code)) ? String(result.body.code) : null;
    await saveState();
    return failure("服务商未确认受理，请查询原提现单后处理");
  }
  snapshot.month = data.month;
  snapshot.outBatchNo = data.out_batch_no;
  w.providerOrderId = data.out_batch_no;
  w.providerStatus = "PROCESSING";
  w.updatedAt = new Date().toISOString();
  await saveState();
  // code=200 is acceptance only, never receipt of funds.
  return { ok: true, withdrawal: w };
}
async function query(state, w, settle) {
  const s = w.submission;
  if (!s || s.protocol !== "OAUTH" || s.transferMode !== w.transferMode || s.orderId !== w.providerMerchantOrderId
    || s.openid !== w.openid || s.account !== huifu.oauthAccount({ id: w.userId, openid: w.openid })
    || s.amountCents !== Math.round(Number(w.arrivalAmount ?? w.amount) * 100)
    || !s.merchantId || !s.appid || !/^[a-zA-Z0-9]{5,40}$/.test(s.batchNo || "") || !/^\d{6}$/.test(s.month || "")) {
    return failure("提现提交凭据不完整或不一致，请人工核对", 409);
  }
  let batchResult, detailResult;
  try {
    batchResult = await huifu.batchQuery({ batch_no: s.batchNo, month: s.month, detail_status: "ALL", offset: 0, limit: 20 });
    if (!batchResult.ok) return failure("服务商批次查询失败，请稍后重试");
    detailResult = await huifu.batchDetailQuery({ batch_no: s.batchNo, month: s.month, order_id: s.orderId });
  } catch { return failure("服务商查询暂不可用，请稍后重试"); }
  if (!detailResult.ok) return failure("服务商明细查询失败，请稍后重试");
  const batch = batchResult.body?.data?.transfer_batch, details = batchResult.body?.data?.transfer_detail_list;
  const data = detailResult.body?.data;
  // A FINISHED batch can contain failed transfers: settle only its own detail.
  if (!batch || !data || batch.batch_no !== s.batchNo || data.batch_no !== s.batchNo || data.order_id !== s.orderId
    || Number(batch.total_num) !== 1 || Number(batch.total_amount) !== s.amountCents
    || !Array.isArray(details) || details.length !== 1 || details[0].order_id !== s.orderId
    || (batch.batch_id && data.batch_id && batch.batch_id !== data.batch_id)) return failure("服务商批次、金额或明细与提现单不一致", 409);
  // The settlement rail may use Huifu's own WeChat merchant/app identifiers.
  // Only the merchant-generated batch/detail and saved amount identify this payment.
  const payStatus = Number(data.pay_status);
  if (![-1, 1, 2, 3, 4].includes(payStatus) || Number(details[0].pay_status) !== payStatus) return failure("服务商支付状态待确认，请稍后查询");
  let taxInfo;
  if (payStatus === 3 && data.tax_info != null) {
    const tax = data.tax_info;
    if (![tax.vat_amount, tax.iit_amount, tax.received_price].every(value => Number.isSafeInteger(value) && value >= 0)
      || tax.vat_amount + tax.iit_amount + tax.received_price !== s.amountCents) return failure("服务商代扣金额与提现单不一致", 409);
    taxInfo = { vatAmountCents: tax.vat_amount, incomeTaxCents: tax.iit_amount, receivedAmountCents: tax.received_price };
  }
  if ([3, 4].includes(payStatus)) {
    // Canonical settlement uses the original amount; withheld taxes remain separately recorded.
    const result = settle(state, { order_id: s.orderId, pay_status: payStatus, amount_cents: s.amountCents,
      error_code: payStatus === 3 ? "SUCCESS" : "FAIL", error_msg: data.error_code || "" });
    if (result.ok) {
      if (taxInfo && !result.idempotent) s.taxInfo = taxInfo;
      if (payStatus === 4 && data.error_code === "OAUTH_FAIL") {
        const user = state.users.find(item => item.id === w.userId);
        if (user?.huifuAuthorization?.mode === "OAUTH" && user.huifuAuthorization.account === s.account) user.huifuAuthorization.status = "invalid";
      }
      await saveState();
    }
    return result;
  }
  if (!["success", "failed", "rejected", "cancelled"].includes(w.status)) {
    w.providerStatus = payStatus === -1 ? "UNKNOWN" : "PROCESSING";
    w.lastQueryAt = new Date().toISOString();
    w.updatedAt = w.lastQueryAt;
    await saveState();
  }
  return { ok: true, withdrawal: w };
}
module.exports = { submit, query };
