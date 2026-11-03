const crypto = require("node:crypto");
const { saveState } = require("../data/store");
const { exclusive } = require("./operation-lock");
const rules = require("./coin-signin-config");
const verifier = require("./signin-ad-verifier");
const fail = (status, error) => ({ ok: false, status, error });
const day = now => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const id = () => crypto.randomUUID();
const data = state => state.coinSignin || { sessions: [], ledger: [] };
const balance = (state, userId) => data(state).ledger.filter(entry => entry.userId === userId).reduce((sum, entry) => sum + entry.coins, 0);
function unavailable(state, c, provider) {
  if (!rules.config(state).enabled) return "签到活动暂未开放";
  if (rules.validate(c)) return "签到规则或广告位尚未配置完整";
  if (!c.rewardedAdUnitId || (c.sequence.includes("interstitial") && !c.interstitialAdUnitId)) return "签到广告位尚未配置";
  if (!provider.configured()) return "广告完成验证尚未准备好，签到暂不可用";
  return "";
}
function status(state, user, now = Date.now(), provider = verifier) {
  const session = data(state).sessions.find(s => s.userId === user.id && s.date === day(now));
  const c = session?.config || rules.config(state);
  return { ok: true, serverNow: now, date: day(now), balanceCoins: balance(state, user.id), unit: "金币", config: c,
    unavailableReason: unavailable(state, c, provider),
    session: session ? { id: session.id, rounds: session.rounds, completedRounds: session.completedRounds, claimed: Boolean(session.claimedAt), claimedAt: session.claimedAt || null,
      nextAt: session.nextAt, rewardCoins: c.rewardCoins } : null };
}
function attemptView(attempt, c) {
  return { id: attempt.id, expiresAt: attempt.expiresAt, nextStep: attempt.nextStep, completed: attempt.completed,
    steps: attempt.steps.map(step => ({ id: step.id, type: step.type, adUnitId: step.type === "rewarded" ? c.rewardedAdUnitId : c.interstitialAdUnitId })) };
}
async function transaction(state, fn, persist) {
  return exclusive(state, async () => {
    const before = structuredClone(data(state));
    state.coinSignin ||= { sessions: [], ledger: [] };
    try { const result = await fn(); if (result.ok) await persist(); else state.coinSignin = before; return result; }
    catch (error) { state.coinSignin = before; throw error; }
  });
}
// Dependencies are supplied only by trusted application code/tests, never request fields.
async function execute(state, user, action, input = {}, deps = {}) {
  const provider = deps.verifier || verifier, now = deps.now ?? Date.now(), persist = deps.persist || saveState;
  if (!user || !state.users.some(u => u.id === user.id)) return fail(401, "请先登录");
  return transaction(state, async () => {
    const store = data(state), date = day(now);
    let s = store.sessions.find(item => item.userId === user.id && item.date === date);
    if (action === "start") {
      if (s) return status(state, user, now, provider);
      const c = structuredClone(rules.config(state)), reason = unavailable(state, c, provider);
      if (reason) return fail(503, reason);
      s = { id: id(), userId: user.id, date, config: c, rounds: crypto.randomInt(c.minRounds, c.maxRounds + 1), completedRounds: 0, nextAt: 0, attempt: null, claimedAt: null, createdAt: now };
      store.sessions.push(s);
      return status(state, user, now, provider);
    }
    if (!s || input.sessionId !== s.id) return fail(409, "签到日期或会话已变化，请刷新后继续");
    if (action === "claim") {
      const key = `coin-signin:${user.id}:${date}`, existing = store.ledger.find(entry => entry.idempotencyKey === key);
      if (existing) {
        if (existing.sessionId !== s.id || existing.coins !== s.config.rewardCoins) return fail(409, "签到流水需核对，请联系客服");
        s.claimedAt ||= existing.createdAt;
        return status(state, user, now, provider);
      }
      if (s.claimedAt) return fail(409, "奖励流水待核对，请联系客服");
      if (s.completedRounds !== s.rounds) return fail(409, "请先完成全部签到轮次");
      const total = balance(state, user.id) + s.config.rewardCoins;
      if (!Number.isSafeInteger(total)) return fail(409, "金币余额超出范围，请联系客服");
      store.ledger.push({ id: id(), idempotencyKey: key, sessionId: s.id, userId: user.id, coins: s.config.rewardCoins, balanceAfter: total, reason: "签到固定奖励", createdAt: now });
      s.claimedAt = now;
      return status(state, user, now, provider);
    }
    if (action === "step" && s.attempt?.id === input.attemptId && s.attempt.steps.some((step, index) => step.id === input.stepId && index < s.attempt.nextStep)) {
      return { ...status(state, user, now, provider), attempt: attemptView(s.attempt, s.config) };
    }
    if (s.claimedAt || s.completedRounds >= s.rounds) return fail(409, "全部轮次已完成，请查看奖励状态");
    const reason = unavailable(state, s.config, provider);
    if (reason) return fail(503, reason);
    if (action === "round") {
      if (typeof input.idempotencyKey !== "string" || !/^[a-zA-Z0-9:_-]{8,100}$/.test(input.idempotencyKey)) return fail(400, "获取请求标识无效");
      if (s.attempt?.key === input.idempotencyKey) {
        if (s.attempt.expiresAt <= now) return fail(409, "本轮已过期，请重新获取");
        return { ...status(state, user, now, provider), attempt: attemptView(s.attempt, s.config) };
      }
      if (now < s.nextAt) return fail(409, "请等待轮间倒计时结束");
      // A new attempt discards ONLY the unfinished group, never completed rounds.
      s.attempt = { id: id(), key: input.idempotencyKey, expiresAt: now + 30 * 60000, nextStep: 0, completed: false,
        steps: s.config.sequence.map(type => ({ id: id(), type, receiptId: null })), createdAt: now };
      return { ...status(state, user, now, provider), attempt: attemptView(s.attempt, s.config) };
    }
    if (action === "step") {
      const attempt = s.attempt;
      if (!attempt || attempt.id !== input.attemptId || attempt.expiresAt <= now) return fail(409, "本轮已失效，请重新获取");
      const index = attempt.steps.findIndex(step => step.id === input.stepId);
      if (index < 0 || index > attempt.nextStep) return fail(409, "请按顺序完成本轮广告");
      if (index < attempt.nextStep) return { ...status(state, user, now, provider), attempt: attemptView(attempt, s.config) };
      const step = attempt.steps[index], adUnitId = step.type === "rewarded" ? s.config.rewardedAdUnitId : s.config.interstitialAdUnitId;
      let receipt;
      try { receipt = await provider.verify({ userId: user.id, wechatOpenid: user.wechatOpenid || user.openid || "", sessionId: s.id, attemptId: attempt.id, stepId: step.id, stepIndex: index, adUnitId, adType: step.type, startedAt: attempt.createdAt }); }
      catch { return fail(503, "广告完成结果暂无法确认，请重试核对"); }
      if (!receipt || typeof receipt.receiptId !== "string" || !receipt.receiptId.trim()) return fail(409, "尚未确认广告完整完成，请稍后核对或重新获取本轮");
      if (store.sessions.some(session => (session.receipts || []).includes(receipt.receiptId))) return fail(409, "广告完成凭据已使用");
      // Expiry/day is rechecked after a potentially slow external verification.
      const checkedAt = deps.now ?? Date.now();
      if (day(checkedAt) !== date || attempt.expiresAt <= checkedAt) return fail(409, "本轮已过期，请刷新签到状态");
      step.receiptId = receipt.receiptId;
      (s.receipts ||= []).push(receipt.receiptId);
      attempt.nextStep++;
      if (attempt.nextStep === attempt.steps.length) { attempt.completed = true; s.completedRounds++; s.nextAt = checkedAt + s.config.intervalSeconds * 1000; }
      return { ...status(state, user, checkedAt, provider), attempt: attemptView(attempt, s.config) };
    }
    return fail(400, "签到操作无效");
  }, persist);
}
module.exports = { status, execute, day };
