const { nextId, saveState } = require("../data/store");
const ledgerRepository = require("../repositories/ledger-repository");

function getInviteInfo(state, user) {
  const invited = listInviteUsers(state, user);
  const totalCommission = state.pointLedger
    .filter((entry) => entry.userId === user.id && entry.changeType === "invite_commission")
    .reduce((sum, entry) => sum + entry.points, 0);
  return {
    inviteCode: user.inviteCode,
    shareUrl: `https://tgg.example/register?invite=${user.inviteCode}`,
    rewardInvite: state.config.inviteRewardPoints,
    rewardRatio: state.config.inviteCommissionRate,
    totalInvited: invited.length,
    totalCommission
  };
}

function listInviteUsers(state, user) {
  return (state.inviteRelations || [])
    .filter((relation) => relation.inviterUserId === user.id)
    .map((relation) => {
      const invitee = state.users.find((item) => item.id === relation.inviteeUserId);
      const contributed = state.pointLedger
        .filter((entry) => entry.userId === user.id && entry.changeType === "invite_commission" && entry.bizNo.includes(relation.inviteeUserId))
        .reduce((sum, entry) => sum + entry.points, 0);
      return {
        uid: relation.inviteeUserId,
        nickname: invitee?.nickname || relation.inviteeUserId,
        registeredAt: relation.boundAt,
        contributed
      };
    });
}

function getInviteStats(state, user) {
  const list = listInviteUsers(state, user);
  return {
    totalInvited: list.length,
    totalCommission: list.reduce((sum, item) => sum + item.contributed, 0),
    inviteRewardPoints: state.config.inviteRewardPoints,
    commissionRate: state.config.inviteCommissionRate
  };
}

function getSigninStatus(state, user) {
  const today = todayKey();
  const session = findTodaySession(state, user.id);
  const groupMin = Number(state.config.signinAdGroupMin || 3);
  const groupMax = Number(state.config.signinAdGroupMax || groupMin);
  return {
    date: today,
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
    streakDays: user.signinStreak || 0,
    streakTargetDays: Number(state.config.signinStreakDays || 30),
    streakRewardText: state.config.signinStreakRewardText
  };
}

function startSignin(state, user) {
  const existing = findTodaySession(state, user.id);
  if (existing) return publicSigninSession(state, user, existing);

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
    createdAt: now,
    updatedAt: now
  };
  state.signinSessions.unshift(session);
  saveState();
  return publicSigninSession(state, user, session);
}

function completeSigninAd(state, user, sessionId) {
  const session = state.signinSessions.find((item) => item.sessionId === sessionId && item.userId === user.id) || findTodaySession(state, user.id);
  if (!session) return { ok: false, status: 404, error: "签到会话不存在" };
  if (session.signedToday) return { ok: true, result: { ...publicSigninSession(state, user, session), finished: true } };

  session.completedAds = Math.min(session.completedAds + 1, session.adGroups * 2);
  session.completedGroups = Math.floor(session.completedAds / 2);
  if (session.completedAds >= session.adGroups * 2) {
    session.signedToday = true;
    session.lotteryTicket = 1;
    user.signinStreak = (user.signinStreak || 0) + 1;
  }
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
  if (!session || !session.signedToday || !session.lotteryTicket) return { ok: false, status: 400, error: "请先完成今日广告签到任务" };
  if (session.lotteryUsed) return { ok: false, status: 400, error: "今日抽奖次数已用完" };

  const prize = pickPrize(state.config.lotteryPrizes || []);
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
      bizNo: "lottery",
      idempotencyKey: nextId("lottery"),
      createdAt: new Date().toISOString()
    });
  }
  saveState();
  return { ok: true, prize };
}

function publicSigninSession(state, user, session) {
  return {
    sessionId: session.sessionId,
    adGroups: session.adGroups,
    completedGroups: session.completedGroups,
    completedAds: session.completedAds,
    currentAdType: nextAdType(session),
    signedToday: session.signedToday,
    lotteryTicket: session.lotteryTicket,
    streakDays: user.signinStreak || 0,
    streakRewardText: state.config.signinStreakRewardText
  };
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
    cursor -= Number(item.weight || 0);
    if (cursor <= 0) return { id: item.id, label: item.label, points: Number(item.value || 0) };
  }
  return fallback;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
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
