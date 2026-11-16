// Only a synchronized POS card number identifies an existing checkout customer.
function getMemberCode(state, user) {
  if (!user) return { status: 401, body: { error: "请先登录" } };
  const number = user.pospalNumber;
  if (!user.pospalUid || typeof number !== "string" || !number) {
    return { status: 200, body: { available: false, message: "尚未关联门店会员，请联系门店核对手机号并同步会员资料" } };
  }
  if (!/^[\x21-\x7e]{1,32}$/.test(number)) {
    return { status: 200, body: { available: false, message: "门店会员卡号格式暂不支持，请联系门店核对" } };
  }
  const mappings = state.config?.pospalIntegration?.customerMappings || [];
  const conflict = state.users.some(other => other.id !== user.id &&
    (other.pospalNumber === number || other.pospalUid === user.pospalUid)) ||
    mappings.some(row => row.tggUserId === user.id
      ? row.number !== number || row.pospalUid !== user.pospalUid
      : row.number === number || row.pospalUid === user.pospalUid);
  if (conflict) return { status: 200, body: { available: false, message: "门店会员关联信息异常，请联系门店核对" } };
  return { status: 200, body: { available: true, userId: user.id, number, format: "CODE128" } };
}
module.exports = { getMemberCode };
