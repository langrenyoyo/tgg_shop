const { exchangePhoneCode } = require("./wechat-phone-service");
const { saveState } = require("../data/store");
const { publicUser } = require("../http/http-utils");
const { enqueueMembershipSync, ensureActiveMembershipSync } = require("../domain/pospal-membership");

function verifiedPhone(state, user) {
  const record = state.config?.userPhoneVerifications?.[user?.id];
  return record?.source === "wechat" && record.phone === user.phone && /^1\d{10}$/.test(record.phone) ? record : null;
}
function phoneConflict(state, user, phone) {
  if (state.users.some(other => other.id !== user?.id && other.phone === phone)) return "该手机号已绑定其他账号，请联系客服核对，不能自动合并账号";
  if (user?.phone && user.phone !== phone) return "授权手机号与当前账号不一致，请使用原手机号或联系客服";
  const mapping = state.config?.pospalIntegration?.customerMappings?.find(row => row.tggUserId === user?.id);
  if (mapping?.phone && mapping.phone !== phone) return "授权手机号与门店会员资料不一致，请联系客服核对";
  const attempt = state.config?.pospalIntegration?.memberProvisions?.[user?.id];
  if (attempt?.phone && attempt.phone !== phone) return "授权手机号与待关联门店会员不一致，请联系客服核对";
  return "";
}
function recordPhone(state, user, phone) {
  user.phone = phone;
  state.config ||= {};
  state.config.userPhoneVerifications ||= {};
  state.config.userPhoneVerifications[user.id] = { phone, source: "wechat", verifiedAt: new Date().toISOString() };
  if (state.config.pospalIntegration?.membershipSyncJobs?.[user.id]?.status === "waiting_phone") {
    enqueueMembershipSync(state, user, "phone_verified");
  } else ensureActiveMembershipSync(state, user, "phone_verified_membership");
}
async function bindPhone(state, user, input) {
  if (!user || user.status !== "active") return { status: 401, body: { error: "请先登录" } };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "phoneCode")) return { status: 400, body: { error: "仅支持微信手机号授权" } };
  let phone;
  try { phone = await exchangePhoneCode(input.phoneCode); }
  catch (error) { return { status: 400, body: { error: error.message } }; }
  const conflict = phoneConflict(state, user, phone);
  if (conflict) return { status: 409, body: { error: conflict } };
  if (user.status !== "active") return { status: 403, body: { error: "账号已停用" } };
  const previousPhone = user.phone;
  const previousRecord = state.config?.userPhoneVerifications?.[user.id];
  const previousJob = state.config?.pospalIntegration?.membershipSyncJobs?.[user.id];
  recordPhone(state, user, phone);
  try { await saveState(); } catch (error) {
    user.phone = previousPhone;
    if (previousRecord) state.config.userPhoneVerifications[user.id] = previousRecord;
    else delete state.config.userPhoneVerifications[user.id];
    const jobs = state.config?.pospalIntegration?.membershipSyncJobs;
    if (jobs) {
      if (previousJob) jobs[user.id] = previousJob;
      else delete jobs[user.id];
    }
    throw error;
  }
  return { status: 200, body: publicUser(user) };
}
module.exports = { verifiedPhone, phoneConflict, recordPhone, bindPhone };
