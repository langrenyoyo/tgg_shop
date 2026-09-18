process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const growth = require("../../src/services/growth-service");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");

test("signin requires ordered ad type and one-time completion nonce", () => {
  const state = createSeed();
  state.config.signinAdGroupMin = 1;
  state.config.signinAdGroupMax = 1;
  const user = state.users[0];
  const session = growth.startSignin(state, user);
  assert.equal(session.currentAdType, "reward_video");
  assert.equal(growth.completeSigninAd(state, user, session.sessionId, "interstitial", session.completionToken).status, 400);
  assert.equal(growth.completeSigninAd(state, user, session.sessionId, "reward_video", "wrong").status, 400);
  const first = growth.completeSigninAd(state, user, session.sessionId, "reward_video", session.completionToken);
  assert.equal(first.ok, true);
  assert.equal(first.result.currentAdType, "interstitial");
  assert.equal(growth.completeSigninAd(state, user, session.sessionId, "reward_video", session.completionToken).status, 400);
  const second = growth.completeSigninAd(state, user, session.sessionId, "interstitial", first.result.completionToken);
  assert.equal(second.ok, true);
  assert.equal(second.result.signedToday, true);
  assert.equal(second.result.lotteryAvailable, true);
  const before = user.points;
  const prize = growth.spinLottery(state, user);
  assert.equal(prize.ok, true);
  assert.equal(growth.spinLottery(state, user).idempotent, true);
  assert.ok(user.points >= before);
});

test("signin status cannot be completed for another user session", () => {
  const state = createSeed();
  state.config.signinAdGroupMin = 1;
  state.config.signinAdGroupMax = 1;
  const first = state.users[0];
  const second = state.users[1];
  const session = growth.startSignin(state, first);
  const result = growth.completeSigninAd(state, second, session.sessionId, "reward_video", session.completionToken);
  assert.equal(result.status, 404);
});

test("client nonce never authorizes production ad rewards", () => {
  const state = createSeed();
  const user = state.users[0];
  const session = growth.startSignin(state, user);
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal(growth.getSigninStatus(state, user).adRewardsAvailable, false);
    assert.equal(growth.completeSigninAd(state, user, session.sessionId, session.currentAdType, session.completionToken).status, 503);
    assert.equal(state.signinSessions.find(item => item.sessionId === session.sessionId).completedAds, 0);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("signin start and status agree on streak and numeric reward rules", () => {
  const state = createSeed();
  const user = state.users[0];
  user.signinStreak = 99;
  state.signinSessions = [];
  Object.assign(state.config, { signinStreakDays: 7, signinStreakRewardPoints: 25, signinStreakRewardText: "stale text" });
  const started = growth.startSignin(state, user);
  assert.equal(started.streakDays, 0);
  assert.equal(started.streakRewardText, "连续签到 7 天送 25 积分");
  assert.equal(started.streakRewardText, growth.getSigninStatus(state, user).streakRewardText);
});

test("invalid lottery configuration preserves ticket and balance for recovery", () => {
  const state = createSeed();
  const user = state.users[0];
  growth.startSignin(state, user);
  const session = state.signinSessions[0];
  session.signedToday = true;
  session.lotteryTicket = 1;
  const points = user.points;
  for (const prize of [{ value: -10, weight: 1 }, { value: 0.5, weight: 1 }, { value: 10, weight: -1 }, { value: 10, weight: Infinity }]) {
    state.config.lotteryPrizes = [prize];
    assert.equal(growth.spinLottery(state, user).status, 503);
    assert.equal(session.lotteryTicket, 1);
    assert.equal(session.lotteryUsed, false);
    assert.equal(user.points, points);
  }
  state.config.lotteryPrizes = [{ id: "fixed", label: "5积分", value: 5, weight: 1 }];
  assert.equal(growth.spinLottery(state, user).ok, true);
  assert.equal(user.points, points + 5);
  assert.equal(session.lotteryTicket, 0);
});

test("streak reward, nonce and lottery result survive SQLite reload without duplicate credit", () => {
  const state = createSeed();
  const user = state.users[0];
  state.signinSessions = [];
  Object.assign(state.config, { signinAdGroupMin: 1, signinAdGroupMax: 1, signinStreakDays: 2, signinStreakRewardPoints: 100, lotteryPrizes: [{ id: "fixed", label: "5积分", value: 5, weight: 1 }] });
  const today = growth.getSigninStatus(state, user).date;
  const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  state.signinSessions.push({ sessionId: "yesterday", userId: user.id, date: yesterday, adGroups: 1, completedAds: 2, completedGroups: 1, signedToday: true, lotteryUsed: true });
  const started = growth.startSignin(state, user);
  const before = user.points;
  growth.completeSigninAd(state, user, started.sessionId, started.currentAdType, started.completionToken);
  const filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signin-reload-")), "state.sqlite");
  saveSQLiteState(state, filename);
  const restored = loadSQLiteState(filename);
  const restoredUser = restored.users.find(item => item.id === user.id);
  const resumed = growth.startSignin(restored, restoredUser);
  assert.equal(resumed.completedAds, 1);
  assert.ok(resumed.completionToken);
  growth.completeSigninAd(restored, restoredUser, resumed.sessionId, resumed.currentAdType, resumed.completionToken);
  assert.equal(restoredUser.signinStreak, 2);
  assert.equal(restoredUser.points, before + 100);
  growth.spinLottery(restored, restoredUser);
  saveSQLiteState(restored, filename);
  const final = loadSQLiteState(filename);
  const finalUser = final.users.find(item => item.id === user.id);
  assert.equal(growth.spinLottery(final, finalUser).idempotent, true);
  assert.equal(finalUser.points, before + 105);
  assert.equal(final.pointLedger.filter(item => item.changeType === "signin_streak").length, 1);
});

test("a missing previous day resets the displayed streak", () => {
  const state = createSeed();
  state.signinSessions = [];
  state.users[0].signinStreak = 29;
  assert.equal(growth.getSigninStatus(state, state.users[0]).streakDays, 0);
});
