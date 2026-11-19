const { isMember } = require("../domain/rules");
const { expiryDate } = require("../domain/pospal-membership");
const { verifiedPhone } = require("./phone-binding-service");
const { createPospalClient, isConfigured } = require("../integrations/pospal/pospal-client");

// Read-only purchase gate: a cached sync receipt cannot prove the current phone
// and entitlement still match the store. Never create a card during checkout.
async function checkPurchaseEligibility(state, userId, { membershipRequired = true, client = createPospalClient() } = {}) {
  const fail = (status, error) => ({ ok: false, status, error });
  const local = () => {
    const user = state.users.find(row => row.id === userId);
    if (!user || user.status !== "active") return fail(403, "账号不存在或已停用，请重新登录或联系客服");
    if (!membershipRequired) return { ok: true };
    if (!isMember(user)) return fail(400, "会员未开通或已到期，请先获取有效会员后再购买");
    const integration = state.config?.pospalIntegration || {};
    const provision = integration.memberProvisions?.[user.id];
    const phone = verifiedPhone(state, user)?.phone
      || (provision?.verifiedAt && provision.phone === user.phone ? user.phone : null);
    if (!phone || !/^1\d{10}$/.test(phone)) return fail(400, "请先授权绑定微信手机号，待手机号同步到银豹后再购买");
    const owned = (integration.customerMappings || []).filter(row => row.tggUserId === user.id);
    // Some stores restore the durable mapping without mirroring its identifiers
    // onto the user row. The identity-bound mapping remains the trust anchor.
    const mapping = owned[0], uid = String(user.pospalUid || mapping?.pospalUid || ""), number = user.pospalNumber || mapping?.number;
    if (!uid || !number || !owned.length) return fail(409, "会员手机号尚未同步到银豹，请等待同步完成后重试；如持续失败请联系客服");
    if (owned.length !== 1 || mapping.pospalUid !== uid || mapping.number !== number || mapping.phone !== phone
      || state.users.some(row => row.id !== user.id && (row.phone === phone || String(row.pospalUid || "") === uid || row.pospalNumber === number))
      || integration.customerMappings.some(row => row.tggUserId !== user.id && (row.pospalUid === uid || row.number === number || row.phone === phone))) {
      return fail(409, "会员手机号或银豹关联资料不一致，请联系客服核对后再购买");
    }
    if (!isConfigured(client.config)) return fail(503, "银豹会员核验服务未配置，请联系管理员");
    if ([integration.account, mapping.account, provision?.account, integration.membershipSyncJobs?.[user.id]?.account].some(account => account && account !== client.config.account)) {
      return fail(409, "银豹门店配置已变更，请联系客服核对会员资料");
    }
    if (Date.parse(integration.membershipSyncQuotaUntil) > Date.now()) return fail(503, "银豹服务额度不足，暂时无法核验会员手机号，请联系管理员处理后重试");
    return { ok: true, phone, uid, number, memberUntil: user.memberUntil, account: client.config.account };
  };
  const before = local();
  if (!before.ok || !membershipRequired) return before;
  let response;
  try {
    response = await client.queryCustomers({ number: before.number, lastId: 0, limit: 100, needCustomerExt: true });
  } catch (error) {
    return fail(503, Number(error.errorCode) === 4021
      ? "银豹服务额度不足，暂时无法核验会员手机号，请联系管理员处理后重试"
      : "暂时无法核验银豹会员手机号，请稍后重试；本次未发起购买或付款");
  }
  // Re-read after network I/O: expiry, phone, association or account can change.
  const current = local();
  if (!current.ok) return current;
  if (JSON.stringify(current) !== JSON.stringify(before)) return fail(409, "会员资料已变更，请刷新后重新购买");
  const rows = response?.result?.list;
  if (!Array.isArray(rows) || response.result.hasMore || rows.length !== 1) return fail(409, "银豹会员手机号尚未确认或关联不唯一，请联系客服核对");
  const row = rows[0];
  if (String(row.uid) !== before.uid || row.number !== before.number || row.tel !== before.phone
    || Number(row.enable) !== 1 || Number(row.isLoss || 0) !== 0 || (row.active != null && Number(row.active) !== 0)) {
    return fail(409, "银豹会员手机号或会员状态不一致，请联系客服核对后再购买");
  }
  if (row.expiryDate !== expiryDate(before.memberUntil)) return fail(409, "会员期限尚未同步到银豹，请等待同步完成后再购买");
  return { ok: true };
}

module.exports = { checkPurchaseEligibility };
