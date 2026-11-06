const crypto = require("node:crypto");
const { saveState } = require("../data/store");
const huifu = require("./withdrawal-provider/huifu-bafang");
const locks = new Set();
const STATES = new Set(["WAIT_USER_CONFIRM", "TAKING_EFFECT", "CLOSED"]);
const clean = value => String(value ?? "").trim();
function sessions(state) { return state.huifuAuthorizationSessions ||= []; }
function binding(user, env) {
  return { merchant_id: clean(env.HF_MERCHANT_ID), appid: clean(env.HF_WECHAT_APPID || env.WECHAT_APPID), openid: clean(user?.wechatOpenid || user?.openid) };
}
function matches(session, user, b) {
  return session.userId === user.id && session.openid === b.openid && session.appid === b.appid && session.merchantId === b.merchant_id;
}
function failure(error, status = 502) { return { ok: false, status, error }; }
async function exclusive(user, action) {
  if (locks.has(user.id)) return failure("授权状态正在处理中，请稍后重试", 409);
  locks.add(user.id);
  try { return await action(); } finally { locks.delete(user.id); }
}
function publicStatus(user, session, env) {
  const active = huifu.activeAuthorization(user, env);
  return { ok: true, required: true, status: active ? "active" : session?.status || "none",
    expiresAt: session?.status === "pending" ? session.expiresAt : undefined };
}
function publicStart(user, session, env) {
  return { ...publicStatus(user, session, env), appId: session.appid, mchId: session.merchantId,
    authorizationPackage: session.status === "pending" ? session.packageInfo : undefined };
}
async function applyResult(state, user, data, env, session, fullBinding = true) {
  const b = binding(user, env);
  if (!data || !STATES.has(data.state) || !clean(data.authorization_no)) return failure("服务商返回的授权状态无效");
  if (fullBinding && Object.keys(b).some(key => data[key] !== b[key])) return failure("授权结果与当前微信或商户不匹配", 409);
  if (session && (session.authorizationNo !== data.authorization_no || !matches(session, user, b))) return failure("授权单与当前账号不匹配", 409);
  session ||= sessions(state).find(item => item.authorizationNo === data.authorization_no && matches(item, user, b));
  if (!session) {
    session = { id: data.authorization_no, authorizationNo: data.authorization_no, userId: user.id, openid: b.openid, appid: b.appid, merchantId: b.merchant_id, createdAt: new Date().toISOString() };
    sessions(state).unshift(session);
  }
  // CLOSED is terminal for this authorization number, including out-of-order callbacks.
  if (["revoked", "expired"].includes(session.status) && data.state !== "CLOSED") return failure("授权已关闭，请重新查询或申请", 409);
  if (data.state === "WAIT_USER_CONFIRM" && session.status === "active") return failure("授权状态不一致，请稍后查询", 409);
  const now = new Date().toISOString();
  session.providerState = data.state;
  session.status = data.state === "TAKING_EFFECT" ? "active" : data.state === "CLOSED" ? (data.close_reason === "USER_OVERDUE_UNCONFIRMED" ? "expired" : "revoked") : "pending";
  session.packageInfo = session.status === "pending" ? clean(data.package_info) : undefined;
  session.closeReason = clean(data.close_reason);
  session.updatedAt = now;
  // Huifu timestamps without a zone are China Standard Time. Only pending applications expire in 24h.
  const sourceTime = clean(data.wx_create_time || data.create_time);
  const created = sourceTime ? Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(sourceTime) ? sourceTime.replace(" ", "T") + "+08:00" : sourceTime) : Date.parse(session.createdAt);
  session.expiresAt = new Date((Number.isFinite(created) ? created : Date.parse(session.createdAt)) + 86400000).toISOString();
  user.huifuAuthorization = { authorizationNo: session.authorizationNo, status: session.status, merchantId: session.merchantId,
    appid: session.appid, openid: session.openid, verifiedAt: now, ...(session.status === "active" ? {} : { revokedAt: now }) };
  await saveState();
  return { ok: true, session };
}
async function refresh(state, user, env) {
  const b = binding(user, env);
  if (!b.openid || !b.appid || !b.merchant_id) return failure("微信账号或商户配置不完整", 503);
  let result;
  try { result = await huifu.authorizationQuery(b, env); }
  catch { return failure("授权状态查询失败，请稍后刷新"); }
  // Documented not-found is distinct from binding, whitelist, rate-limit and network errors.
  if (!result.ok && Number(result.body?.code) === 1002 && result.httpStatus === 200) {
    if (user.huifuAuthorization) user.huifuAuthorization = { ...user.huifuAuthorization, status: "invalid" };
    await saveState();
    return { ok: true, session: null };
  }
  if (!result.ok) return failure("授权状态查询失败，请稍后刷新", result.configured === false ? 503 : 502);
  return applyResult(state, user, result.body?.data, env);
}
async function statusForUser(state, user, env = process.env) {
  if (huifu.transferMode({}, env) === "OAUTH") return exclusive(user, () => require("./huifu-oauth-service").getConfig(user, env));
  if (huifu.transferMode({}, env) !== "AUTH") return { ok: true, required: false, status: "none" };
  return exclusive(user, async () => {
    const result = await refresh(state, user, env);
    return result.ok ? publicStatus(user, result.session, env) : result;
  });
}
async function start(state, user, input = {}, env = process.env) {
  if (huifu.transferMode({}, env) === "OAUTH") return exclusive(user, () => require("./huifu-oauth-service").getConfig(user, env, true));
  if (huifu.transferMode({}, env) !== "AUTH") return failure("当前提现模式未启用 AUTH 授权", 409);
  const b = binding(user, env);
  if (!/^\d{5,20}$/.test(b.merchant_id) || (env.HF_WECHAT_MCH_ID && env.HF_WECHAT_MCH_ID !== b.merchant_id)) return failure("微信商户号配置不一致或无效", 503);
  return exclusive(user, async () => {
    const checked = await refresh(state, user, env);
    if (!checked.ok) return checked;
    if (["active", "pending"].includes(checked.session?.status)) {
      if (checked.session.status === "pending" && (!checked.session.packageInfo || Date.parse(checked.session.expiresAt) <= Date.now())) return failure("待确认授权已过期或授权包缺失，请稍后刷新");
      return publicStart(user, checked.session, env);
    }
    // Save the merchant-generated number before applying; uncertain requests reuse it after query.
    let session = sessions(state).find(item => matches(item, user, b) && item.status === "requesting");
    if (!session) {
      const id = "HFA" + crypto.randomBytes(14).toString("hex");
      session = { id, authorizationNo: id, userId: user.id, merchantId: b.merchant_id, appid: b.appid, openid: b.openid, status: "requesting", createdAt: new Date().toISOString() };
      sessions(state).unshift(session);
    }
    await saveState();
    let result;
    try {
      result = await huifu.authorizationStart({ ...b, authorization_no: session.authorizationNo,
        user_display_name: Array.from(clean(user.nickname) || "小鹿用户").slice(0, 32).join(""),
        user_recv_perception: env.HF_USER_RECV_PERCEPTION || "现金奖励", notify_url: env.HF_AUTHORIZATION_CALLBACK_URL }, env);
    } catch { return failure("授权申请结果暂未确认，请刷新后重试"); }
    if (!result.ok) return failure("授权申请失败，请刷新状态后重试", result.configured === false ? 503 : 502);
    const applied = await applyResult(state, user, result.body?.data, env, session, false);
    if (!applied.ok) return applied;
    if (session.status === "pending" && !session.packageInfo) return failure("服务商未返回微信授权包，请刷新状态");
    return publicStart(user, session, env);
  });
}
async function handleCallback(state, input = {}) {
  const data = input.data && typeof input.data === "object" ? input.data : input;
  if (data.notify_type !== "wx_transfer_auth" || !STATES.has(data.state)) return failure("授权回调类型或状态无效", 400);
  const session = sessions(state).find(item => item.authorizationNo === data.authorization_no);
  const user = session && state.users.find(item => item.id === session.userId);
  if (!user) return failure("授权单不存在", 404);
  const b = binding(user, process.env);
  if (!matches(session, user, b) || Object.keys(b).some(key => data[key] !== b[key])) return failure("授权回调绑定不匹配", 409);
  // Query current state so delayed/replayed callbacks cannot restore old consent.
  return exclusive(user, async () => {
    const current = await refresh(state, user, process.env);
    return current.ok ? { ok: true } : current;
  });
}
module.exports = { start, handleCallback, statusForUser, sessions };
