const { nextId, saveState } = require("../data/store");
const ledgerRepository = require("../repositories/ledger-repository");

function getInviteInfo(state, user) {
  const invitedCount = (state.inviteRelations || []).filter(relation => relation.inviterUserId === user.id).length;
  const totalCommission = state.pointLedger
    .filter((entry) => entry.userId === user.id && entry.changeType === "invite_commission")
    .reduce((sum, entry) => sum + entry.points, 0);
  return {
    inviteCode: user.inviteCode,
    shareUrl: `https://tgg.example/register?invite=${user.inviteCode}`,
    rewardInvite: state.config.inviteRewardPoints,
    rewardRatio: Number(state.config.inviteCommissionRate || 0) * 100,
    totalInvited: invitedCount,
    totalCommission
  };
}

function listInviteUsers(state, user, query = {}) {
  const owners = new Map(state.submissions.map(item => [item.id, item.userId]));
  const contributions = new Map();
  for (const entry of state.pointLedger) {
    if (entry.userId !== user.id || entry.changeType !== "invite_commission") continue;
    const owner = owners.get(entry.bizNo);
    if (owner) contributions.set(owner, (contributions.get(owner) || 0) + entry.points);
  }
  let relations = (state.inviteRelations || []).filter(relation => relation.inviterUserId === user.id);
  const total = relations.length;
  const paged = query.page !== undefined || query.count !== undefined;
  const page = Number(query.page || 1), count = Number(query.count || 20);
  if (paged) relations = relations.slice().sort((a, b) => String(b.boundAt).localeCompare(String(a.boundAt)) || String(b.inviteeUserId).localeCompare(String(a.inviteeUserId))).slice((page - 1) * count, page * count);
  const users = new Map(state.users.map(item => [item.id, item]));
  const rows = relations
    .map((relation) => {
      const invitee = users.get(relation.inviteeUserId);
      const contributed = contributions.get(relation.inviteeUserId) || 0;
      return {
        uid: relation.inviteeUserId,
        nickname: invitee?.nickname || relation.inviteeUserId,
        registeredAt: relation.boundAt,
        contributed
      };
    });
  return paged ? { rows, total, page, count } : rows;
}

function getInviteStats(state, user) {
  const list = listInviteUsers(state, user);
  return {
    totalInvited: list.length,
    totalCommission: list.reduce((sum, item) => sum + item.contributed, 0),
    inviteRewardPoints: state.config.inviteRewardPoints,
    commissionRate: Number(state.config.inviteCommissionRate || 0) * 100
  };
}

function getSigninStatus(state, user) {
  const today = todayKey();
  const session = findTodaySession(state, user.id);
  const groupMin = Number(state.config.signinAdGroupMin || 3);
  const groupMax = Number(state.config.signinAdGroupMax || groupMin);
  return {
    date: today,
    adRewardsAvailable: process.env.NODE_ENV !== "production",
    unavailableReason: process.env.NODE_ENV === "production" ? "签到活动暂未开放，请稍后再来" : "",
    sessionId: session?.sessionId || null,
    completionToken: session?.nextAdNonce || null,
    prize: session?.prize || null,
    groupMin,
    groupMax,
    adGroups: session?.adGroups || null,
    completedGroups: session?.completedGroups || 0,
    currentAdType: nextAdType(session),
    totalAds: session ? session.adGroups * 2 : null,
    completedAds: session ? session.completedAds : 0,
    signedToday: Boolean(session?.signedToday),
    lotteryTicket: session?.lotteryTicket || 0,
    lotteryUsed: Boolean(session?.lotteryUsed),
    streakDays: consecutiveDays(state, user.id, session?.signedToday ? today : previousDay(today)),
    streakTargetDays: Number(state.config.signinStreakDays || 30),
    streakRewardPoints: Number(state.config.signinStreakRewardPoints ?? 100),
    streakRewardText: `连续签到 ${Number(state.config.signinStreakDays || 30)} 天送 ${Number(state.config.signinStreakRewardPoints ?? 100)} 积分`
  };
}

function startSignin(state, user) {
  const existing = findTodaySession(state, user.id);
  if (existing) {
    if (!existing.nextAdNonce) { existing.nextAdNonce = nextId("ad"); saveState(); }
    return publicSigninSession(state, user, existing);
  }

  const min = Number(state.config.signinAdGroupMin || 3);
  const max = Number(state.config.signinAdGroupMax || min);
  const adGroups = Math.floor(min + Math.random() * (max - min + 1));
  const now = new Date().toISOString();
  const session = {
    sessionId: nextId("signin"),
    userId: user.id,
    date: todayKey(),
    adGroups,
    completedGroups: 0,
    completedAds: 0,
    signedToday: false,
    lotteryTicket: 0,
    lotteryUsed: false,
    nextAdNonce: nextId("ad"),
    createdAt: now,
    updatedAt: now
  };
  state.signinSessions.unshift(session);
  saveState();
  return publicSigninSession(state, user, session);
}

function completeSigninAd(state, user, sessionId, adType, completionToken) {
  // A client nonce only prevents replay; it is not proof of ad playback.
  // Until the provider verification adapter exists, never award in production.
  if (process.env.NODE_ENV === "production") return { ok: false, status: 503, error: "广告服务端验证尚未接通，暂不能领取签到奖励" };
  const session = state.signinSessions.find((item) => item.sessionId === sessionId && item.userId === user.id && item.date === todayKey());
  if (!session) return { ok: false, status: 404, error: "签到会话不存在" };
  if (session.signedToday) return { ok: true, result: { ...publicSigninSession(state, user, session), finished: true } };
  const expectedType = nextAdType(session);
  if (!adType || adType !== expectedType) return { ok: false, status: 400, error: "广告类型顺序不正确" };
  if (!completionToken || completionToken !== session.nextAdNonce) return { ok: false, status: 400, error: "广告完成凭据无效，请从广告 SDK 回调后重试" };

  session.completedAds = Math.min(session.completedAds + 1, session.adGroups * 2);
  session.completedGroups = Math.floor(session.completedAds / 2);
  if (session.completedAds >= session.adGroups * 2) {
    session.signedToday = true;
    session.lotteryTicket = 1;
    user.signinStreak = consecutiveDays(state, user.id, session.date);
    const target = Number(state.config.signinStreakDays || 30);
    const reward = Number(state.config.signinStreakRewardPoints ?? 100);
    const key = `signin_streak:${user.id}:${session.date}`;
    if (Number.isSafeInteger(target) && target > 0 && user.signinStreak % target === 0 && Number.isSafeInteger(reward) && reward > 0 && !state.pointLedger.some(item => item.idempotencyKey === key)) {
      user.points += reward;
      ledgerRepository.addPointEntry(state, { id: nextId("pt"), userId: user.id, changeType: "signin_streak", direction: "in", points: reward, balanceAfter: user.points, bizNo: session.sessionId, idempotencyKey: key, createdAt: new Date().toISOString() });
    }
  }
  session.nextAdNonce = nextId("ad");
  session.updatedAt = new Date().toISOString();
  saveState();
  return {
    ok: true,
    result: {
      ...publicSigninSession(state, user, session),
      finished: session.signedToday,
    lotteryAvailable: session.lotteryTicket > 0 && !session.lotteryUsed
    }
  };
}

function spinLottery(state, user) {
  const session = findTodaySession(state, user.id);
  if (session?.lotteryUsed && session.prize) return { ok: true, prize: session.prize, idempotent: true };
  if (!session || !session.signedToday || !session.lotteryTicket) return { ok: false, status: 400, error: "请先完成今日广告签到任务" };
  if (session.lotteryUsed) return { ok: false, status: 400, error: "今日抽奖次数已用完" };

  const prizes = state.config.lotteryPrizes || [];
  if (!Array.isArray(prizes) || prizes.some(item => !item || !Number.isSafeInteger(Number(item.value)) || Number(item.value) < 0 || !Number.isFinite(Number(item.weight)) || Number(item.weight) < 0) || !Number.isFinite(prizes.reduce((sum, item) => sum + Number(item.weight), 0))) {
    return { ok: false, status: 503, error: "抽奖配置异常，请稍后重试" };
  }
  const prize = pickPrize(prizes);
  if (!Number.isSafeInteger(user.points + prize.points)) return { ok: false, status: 503, error: "积分账户暂不可入账，请联系客服" };
  session.prize = prize;
  session.lotteryUsed = true;
  session.lotteryTicket = 0;
  session.updatedAt = new Date().toISOString();
  if (prize.points) {
    user.points += prize.points;
    ledgerRepository.addPointEntry(state, {
      id: nextId("pt"),
      userId: user.id,
      changeType: "lottery",
      direction: "in",
      points: prize.points,
      balanceAfter: user.points,
      bizNo: session.sessionId,
      idempotencyKey: `lottery:${session.sessionId}`,
      createdAt: new Date().toISOString()
    });
  }
  saveState();
  return { ok: true, prize };
}

function publicSigninSession(state, user, session) {
  return getSigninStatus(state, user);
}

function findTodaySession(state, userId) {
  const today = todayKey();
  return state.signinSessions.find((session) => session.userId === userId && session.date === today);
}

function nextAdType(session) {
  if (!session || session.signedToday) return null;
  return session.completedAds % 2 === 0 ? "reward_video" : "interstitial";
}

function pickPrize(prizes) {
  const fallback = { label: "谢谢参与", points: 0 };
  const total = prizes.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  if (!total) return fallback;
  let cursor = Math.random() * total;
  for (const item of prizes) {
    if (Number(item.weight) <= 0) continue;
    cursor -= Number(item.weight || 0);
    if (cursor <= 0) return { id: item.id, label: item.label, points: Number(item.value || 0) };
  }
  return fallback;
}

function todayKey() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function previousDay(date) {
  return new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
}

function consecutiveDays(state, userId, date) {
  const dates = new Set(state.signinSessions.filter(item => item.userId === userId && item.signedToday).map(item => item.date));
  let count = 0;
  while (dates.has(date)) { count++; date = previousDay(date); }
  return count;
}

module.exports = {
  getInviteInfo,
  listInviteUsers,
  getInviteStats,
  getSigninStatus,
  startSignin,
  completeSigninAd,
  spinLottery
};
