const { isMember } = require("../domain/rules");
// Only a synchronized POS card number identifies an existing checkout customer.
function getMemberCode(state, user) {
  if (!user) return { status: 401, body: { error: "请先登录" } };
  const mappings = state.config?.pospalIntegration?.customerMappings || [];
  const owned = mappings.filter(row => row.tggUserId === user.id);
  const membership = { isMember: isMember(user) };
  const unavailable = (reason, message) => ({ status: 200, body: { available: false, ...membership, reason, message } });
  if (owned.length > 1) return unavailable("association_conflict", "门店会员关联信息异常，请联系门店核对");
  const mapping = owned[0];
  // Read the existing identity-bound mapping if the user record was not mirrored.
  const number = user.pospalNumber || mapping?.number;
  const uid = user.pospalUid || mapping?.pospalUid;
  if (!uid || typeof number !== "string" || !number) {
    const prefix = membership.isMember ? "小程序会员已开通，无需重复购买。" : "";
    return unavailable(user.phone ? "association_missing" : "phone_missing", prefix + (user.phone
      ? "门店会员卡尚未关联，请联系门店核对账号并同步银豹会员资料。"
      : "当前账号没有绑定手机号，暂不能按手机号关联门店会员，请联系客服协助核对账号和门店会员卡。"));
  }
  if (!/^[\x21-\x7e]{1,32}$/.test(number)) {
    return unavailable("unsupported_number", "门店会员卡号格式暂不支持，请联系门店核对");
  }
  const conflict = state.users.some(other => other.id !== user.id &&
    (other.pospalNumber === number || other.pospalUid === uid)) ||
    mappings.some(row => row.tggUserId === user.id
      ? row.number !== number || row.pospalUid !== uid
      : row.number === number || row.pospalUid === uid);
  if (conflict) return unavailable("association_conflict", "门店会员关联信息异常，请联系门店核对");
  return { status: 200, body: { available: true, userId: user.id, number, format: "CODE128" } };
}
module.exports = { getMemberCode };
