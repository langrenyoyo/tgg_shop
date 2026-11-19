const crypto = require("node:crypto");
const { saveState } = require("../data/store");
const { isMember } = require("../domain/rules");
const { getMemberCode } = require("./member-code-service");
const { exchangePhoneCode } = require("./wechat-phone-service");
const { verifiedPhone } = require("./phone-binding-service");
const { createPospalClient, isConfigured } = require("../integrations/pospal/pospal-client");
const { expiryDate } = require("../domain/pospal-membership");

// Serializes callers within one state instance. PostgreSQL's state CAS persists
// intent before external writes; stale workers cannot create a second identity.
const locks = new WeakMap();
function provisionMember(state, user, input = {}, dependencies = {}) {
  let pending = locks.get(state);
  if (!pending) { pending = new Map(); locks.set(state, pending); }
  const key = user?.id;
  if (pending.has(key)) return pending.get(key);
  const task = run(state, user, input, dependencies).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
async function run(state, user, input, dependencies) {
  const fail = (status, error) => ({ status, body: { error } });
  if (!user || user.status !== "active") return fail(401, "请先登录");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "phoneCode")) return fail(400, "仅支持微信手机号授权");
  const current = getMemberCode(state, user);
  if (current.body.available) return current;
  if (!["phone_missing", "association_missing", "provision_required"].includes(current.body.reason)) return fail(409, current.body.message);
  if (!isMember(user)) return fail(403, "请先开通小程序会员");
  // Partial historical identities require reconciliation, never a new card.
  if (user.pospalUid || user.pospalNumber || state.config?.pospalIntegration?.customerMappings?.some(row => row.tggUserId === user.id)) {
    return fail(409, "已有门店会员关联资料不完整，请联系门店核对");
  }
  const client = dependencies.client || createPospalClient();
  if (!isConfigured(client.config)) return fail(503, "门店会员服务未配置，请联系管理员");
  const save = dependencies.save || saveState;
  const verifyPhone = dependencies.verifyPhone || exchangePhoneCode;
  state.config ||= {};
  state.config.pospalIntegration ||= {};
  const integration = state.config.pospalIntegration;
  integration.memberProvisions ||= {};
  let attempt = integration.memberProvisions[user.id];
  if (attempt && attempt.account !== client.config.account) return fail(409, "门店配置已变更，请联系管理员核对会员关联");
  if (attempt?.retryAt && Date.parse(attempt.retryAt) > Date.now()) return fail(429, "会员资料正在同步，请稍后重试");
  try {
    if (!attempt) {
      const phone = verifiedPhone(state, user)?.phone || await verifyPhone(input.phoneCode);
      if (!/^1\d{10}$/.test(phone)) return fail(400, "请授权有效的中国大陆手机号");
      if (state.users.some(other => other.id !== user.id && other.phone === phone)) return fail(409, "该手机号已用于其他账号，请联系客服核对");
      const digest = crypto.createHash("sha256").update(`${client.config.account}:${user.id}`).digest("hex");
      attempt = { account: client.config.account, phone, verifiedAt: new Date().toISOString(),
        number: "88" + BigInt("0x" + digest.slice(0, 20)).toString().padStart(26, "0"),
        marker: "TGG:" + digest, status: "prepared" };
      integration.memberProvisions[user.id] = attempt;
    }
    // Must succeed on every invocation, including retries after a failed save.
    await save();
    const active = () => {
      if (user.status !== "active" || !isMember(user)) throw new Error("membership changed");
      if (state.users.some(other => other.id !== user.id && other.phone === attempt.phone)) throw new Error("phone conflict");
    };
    active();
    async function query(filter) {
      const response = await client.queryCustomers({ ...filter, lastId: 0, limit: 100 });
      if (!Array.isArray(response?.result?.list) || response.result.hasMore) throw new Error("incomplete customer lookup");
      const rows = response.result.list;
      if (rows.some(row => Object.entries(filter).some(([key, value]) => String(row[key] || "") !== value))) throw new Error("unexpected customer lookup");
      if (rows.length > 1) throw new Error("ambiguous customer lookup");
      return rows[0];
    }
    let customer = await query({ number: attempt.number });
    if (customer && (customer.remarks !== attempt.marker || customer.tel !== attempt.phone)) throw new Error("card collision");
    if (!customer) customer = await query({ tel: attempt.phone });
    active();
    if (!customer) {
      // The fixed card number is unique in POSPAL. Never rotate it after timeout.
      attempt.status = "creating";
      await save();
      await client.addCustomer({ number: attempt.number, tel: attempt.phone, name: String(user.nickname || "TGG会员").slice(0, 64),
        expiryDate: expiryDate(user.memberUntil), remarks: attempt.marker, validateTelUnique: true, enable: 1 });
      // Do not trust an acknowledgement alone; confirm the stored identity.
      customer = await query({ number: attempt.number });
      if (!customer || customer.remarks !== attempt.marker || customer.tel !== attempt.phone) throw new Error("unconfirmed creation");
    }
    active();
    const uid = typeof customer.uid === "string" ? customer.uid : Number.isSafeInteger(customer.uid) ? String(customer.uid) : "";
    if (!uid || typeof customer.number !== "string" || !/^[\x21-\x7e]{1,32}$/.test(customer.number) || Number(customer.enable) !== 1 || Number(customer.isLoss || 0) !== 0) throw new Error("invalid customer identity");
    integration.customerMappings ||= [];
    if (state.users.some(other => other.id !== user.id && (other.pospalUid === uid || other.pospalNumber === customer.number)) ||
      integration.customerMappings.some(row => row.tggUserId !== user.id && (row.pospalUid === uid || row.number === customer.number || row.phone === attempt.phone))) throw new Error("identity conflict");
    const existing = getMemberCode(state, user);
    if (existing.body.available) return existing;
    if (user.pospalUid || user.pospalNumber || integration.customerMappings.some(row => row.tggUserId === user.id)) throw new Error("association changed");
    const before = { phone: user.phone, pospalUid: user.pospalUid, pospalNumber: user.pospalNumber, pospalLastSyncAt: user.pospalLastSyncAt };
    const now = new Date().toISOString();
    const mapping = { tggUserId: user.id, pospalUid: uid, number: customer.number, phone: attempt.phone, lastSyncAt: now };
    Object.assign(user, { phone: attempt.phone, pospalUid: uid, pospalNumber: customer.number, pospalLastSyncAt: now });
    integration.customerMappings.push(mapping);
    attempt.status = "linked";
    try { await save(); } catch (error) {
      Object.assign(user, before);
      integration.customerMappings = integration.customerMappings.filter(row => row !== mapping);
      attempt.status = "pending";
      throw error;
    }
    return getMemberCode(state, user);
  } catch (error) {
    if (attempt) {
      attempt.status = "pending";
      attempt.retryAt = new Date(Date.now() + 30000).toISOString();
      await save();
    }
    return fail(503, !attempt ? "请重新授权微信手机号后重试" : Number(error.errorCode) === 4021
      ? "门店会员服务额度不足，请联系管理员处理后重试"
      : "门店会员资料暂未同步成功，请稍后重试；如持续失败请联系客服核对");
  }
}
module.exports = { provisionMember };
