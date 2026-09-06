const { nextId, saveState } = require("../data/store");
const ledgerRepository = require("../repositories/ledger-repository");

const DEFAULT_RULES = [
  { threshold: 500, rewardPoints: 100 },
  { threshold: 1000, rewardPoints: 300 },
  { threshold: 2000, rewardPoints: 800 },
  { threshold: 3000, rewardPoints: 1500 },
  { threshold: 5000, rewardPoints: 3000 }
];

function getMonthlyPointRewardRules(state) {
  return normalizeMonthlyPointRewardRules(state?.config?.monthlyPointRewardRules);
}

function normalizeMonthlyPointRewardRules(input) {
  const source = Array.isArray(input) && input.length ? input : DEFAULT_RULES;
  const seen = new Map();
  for (const item of source) {
    const threshold = Math.floor(Number(item?.threshold));
    const rewardPoints = Math.floor(Number(item?.rewardPoints));
    if (!Number.isFinite(threshold) || threshold <= 0) continue;
    if (!Number.isFinite(rewardPoints) || rewardPoints <= 0) continue;
    seen.set(threshold, { threshold, rewardPoints });
  }
  return Array.from(seen.values()).sort((a, b) => a.threshold - b.threshold);
}

function buildMonthlyPointRewardOverview(state, options = {}) {
  const monthKey = normalizeMonthKey(options.monthKey || getPreviousMonthKey(options.now || new Date()));
  const rules = getMonthlyPointRewardRules(state);
  const monthRange = getMonthRange(monthKey);
  const settlements = state.monthlyPointRewardSettlements || [];
  const thresholdFilter = normalizeThresholdFilter(options.threshold);
  const settledFilter = normalizeSettledFilter(options.settled || options.status);
  const settlementMap = new Map(
    settlements
      .filter((item) => item.monthKey === monthKey && !item.reversedAt)
      .map((item) => [item.userId, item])
  );
  const totals = getMonthTotals(state, monthRange);

  const rows = (state.users || []).map((user) => {
    const totalPoints = totals.get(user.id) || 0;
    const matchedRule = findMatchedRule(rules, totalPoints);
    const settled = settlementMap.get(user.id) || null;
    return {
      userId: user.id,
      nickname: user.nickname,
      totalPoints,
      rewardPoints: matchedRule?.rewardPoints || 0,
      threshold: matchedRule?.threshold || 0,
      settled: Boolean(settled),
      settledAt: settled?.createdAt || "",
      ledgerIdempotencyKey: settled?.idempotencyKey || ""
    };
  }).filter((row) => matchesOverviewFilters(row, thresholdFilter, settledFilter));

  const settlementRows = settlements
    .filter((item) => item.monthKey === monthKey)
    .map((item) => serializeSettlement(state, item))
    .filter((item) => matchesSettlementFilters(item, thresholdFilter, settledFilter));

  return {
    monthKey,
    monthRange,
    rules,
    rows,
    settlements: settlementRows,
    settledCount: rows.filter((row) => row.settled).length,
    eligibleCount: rows.filter((row) => row.rewardPoints > 0).length
  };
}

function settleMonthlyPointRewards(state, options = {}) {
  if (state?.config?.monthlyPointRewardEnabled === false) {
    return { ok: true, appliedCount: 0, months: [], reason: normalizeReason(options.reason), disabled: true };
  }
  const now = options.now ? new Date(options.now) : new Date();
  const cutoffMonthKey = getPreviousMonthKey(now);
  const rules = getMonthlyPointRewardRules(state);
  const result = {
    ok: true,
    appliedCount: 0,
    months: [],
    reason: normalizeReason(options.reason)
  };
  const monthKeys = collectSettledMonthKeys(state, cutoffMonthKey);
  for (const monthKey of monthKeys) {
    const monthResult = settleSingleMonth(state, monthKey, rules, { now, reason: result.reason, actor: options.actor });
    if (monthResult.appliedCount > 0 || monthResult.eligibleCount > 0) {
      result.months.push(monthResult);
      result.appliedCount += monthResult.appliedCount;
    }
  }
  if (result.appliedCount > 0) {
    saveState();
  }
  return result;
}

function settleSingleMonth(state, monthKey, rules, options = {}) {
  if (state?.config?.monthlyPointRewardEnabled === false) {
    return { monthKey, monthRange: getMonthRange(monthKey), appliedCount: 0, eligibleCount: 0, disabled: true };
  }
  const monthRange = getMonthRange(monthKey);
  const totals = getMonthTotals(state, monthRange);
  const settlements = state.monthlyPointRewardSettlements || (state.monthlyPointRewardSettlements = []);
  const settledUsers = new Set(settlements.filter((item) => item.monthKey === monthKey && !item.reversedAt).map((item) => item.userId));
  let appliedCount = 0;
  let eligibleCount = 0;
  const now = options.now ? new Date(options.now) : new Date();
  const createdAt = now.toISOString();

  for (const user of state.users || []) {
    const totalPoints = totals.get(user.id) || 0;
    const matchedRule = findMatchedRule(rules, totalPoints);
    if (!matchedRule) continue;
    eligibleCount += 1;
    const idempotencyKey = `monthly_reward:${monthKey}:${user.id}`;
    if (settledUsers.has(user.id) || state.pointLedger.some((item) => item.idempotencyKey === idempotencyKey)) continue;

    user.points = Number(user.points || 0) + matchedRule.rewardPoints;
    ledgerRepository.addPointEntry(state, {
      id: nextId("pt"),
      userId: user.id,
      changeType: "monthly_reward",
      direction: "in",
      points: matchedRule.rewardPoints,
      balanceAfter: user.points,
      bizNo: `monthly_reward:${monthKey}`,
      idempotencyKey,
      createdAt,
      meta: {
        monthKey,
        threshold: matchedRule.threshold
      }
    });
    settlements.unshift({
      id: nextId("mpr"),
      userId: user.id,
      monthKey,
      threshold: matchedRule.threshold,
      rewardPoints: matchedRule.rewardPoints,
      totalPoints,
      idempotencyKey,
      createdAt
    });
    appliedCount += 1;
  }

  if (appliedCount > 0) {
    appendOperation(state, options.actor, "monthly_reward.settle", monthKey, {
      monthKey,
      appliedCount,
      reason: options.reason,
      rules
    });
  }

  return {
    monthKey,
    monthRange,
    appliedCount,
    eligibleCount
  };
}

function reverseMonthlyPointReward(state, settlementId, options = {}) {
  const settlements = state.monthlyPointRewardSettlements || [];
  const settlement = settlements.find((item) => item.id === settlementId);
  if (!settlement) return { ok: false, status: 404, error: "monthly reward settlement not found" };
  if (settlement.reversedAt) return { ok: false, status: 409, error: "monthly reward settlement already reversed" };

  const user = (state.users || []).find((item) => item.id === settlement.userId);
  if (!user) return { ok: false, status: 404, error: "user not found" };

  const rewardPoints = Math.trunc(Number(settlement.rewardPoints || 0));
  if (!Number.isFinite(rewardPoints) || rewardPoints <= 0) {
    return { ok: false, status: 400, error: "invalid reward points" };
  }

  const beforePoints = Number(user.points || 0);
  if (beforePoints < rewardPoints) {
    return { ok: false, status: 409, error: "user points are insufficient for reversal" };
  }

  const idempotencyKey = `monthly_reward_reversal:${settlement.id}`;
  const existing = (state.pointLedger || []).find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) {
    settlement.reversedAt ||= existing.createdAt || new Date().toISOString();
    settlement.reversalReason ||= normalizeReason(options.reason);
    settlement.status = "reversed";
    saveState();
    return { ok: true, settlement: serializeSettlement(state, settlement), idempotent: true };
  }

  const now = options.now ? new Date(options.now) : new Date();
  const createdAt = now.toISOString();
  user.points = beforePoints - rewardPoints;
  ledgerRepository.addPointEntry(state, {
    id: nextId("pt"),
    userId: user.id,
    changeType: "monthly_reward_reversal",
    direction: "out",
    points: rewardPoints,
    balanceAfter: user.points,
    bizNo: settlement.id,
    idempotencyKey,
    createdAt,
    meta: {
      monthKey: settlement.monthKey,
      originalIdempotencyKey: settlement.idempotencyKey,
      threshold: settlement.threshold
    }
  });

  settlement.reversedAt = createdAt;
  settlement.reversalReason = normalizeReason(options.reason);
  settlement.reversedByRoleId = options.actor?.role?.id || options.actor?.id || "system";
  settlement.status = "reversed";
  appendOperation(state, options.actor, "monthly_reward.reverse", settlement.id, {
    settlementId: settlement.id,
    monthKey: settlement.monthKey,
    userId: user.id,
    rewardPoints,
    beforePoints,
    afterPoints: user.points,
    reason: settlement.reversalReason,
    idempotencyKey
  });
  saveState();
  return { ok: true, settlement: serializeSettlement(state, settlement) };
}

function collectSettledMonthKeys(state, cutoffMonthKey) {
  const keys = new Set();
  for (const entry of state.pointLedger || []) {
    if (!entry || entry.direction !== "in") continue;
    if (entry.changeType === "monthly_reward") continue;
    const monthKey = toMonthKey(entry.createdAt);
    if (!monthKey || monthKey > cutoffMonthKey) continue;
    keys.add(monthKey);
  }
  return Array.from(keys).sort();
}

function getMonthTotals(state, monthRange) {
  const totals = new Map();
  for (const entry of state.pointLedger || []) {
    if (!entry || entry.direction !== "in") continue;
    if (entry.changeType === "monthly_reward") continue;
    const createdAt = entry.createdAt || "";
    if (!inMonthRange(createdAt, monthRange)) continue;
    const current = totals.get(entry.userId) || 0;
    totals.set(entry.userId, current + Number(entry.points || 0));
  }
  return totals;
}

function findMatchedRule(rules, totalPoints) {
  let matched = null;
  for (const rule of rules) {
    if (totalPoints >= rule.threshold) matched = rule;
  }
  return matched;
}

function getMonthRange(monthKey) {
  const [year, month] = monthKey.split("-").map((item) => Number(item));
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

function inMonthRange(value, monthRange) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= monthRange.start && date < monthRange.end;
}

function toMonthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonthKey(date = new Date()) {
  const current = new Date(date);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const previous = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeMonthKey(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : getPreviousMonthKey();
}

function normalizeReason(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeThresholdFilter(value) {
  if (value == null || value === "" || value === "all") return null;
  const threshold = Math.trunc(Number(value));
  return Number.isFinite(threshold) && threshold > 0 ? threshold : null;
}

function normalizeSettledFilter(value) {
  const raw = String(value || "all").trim();
  return ["settled", "unsettled", "reversed"].includes(raw) ? raw : "all";
}

function matchesOverviewFilters(row, thresholdFilter, settledFilter) {
  if (thresholdFilter && Number(row.threshold || 0) !== thresholdFilter) return false;
  if (settledFilter === "settled" && !row.settled) return false;
  if (settledFilter === "unsettled" && row.settled) return false;
  if (settledFilter === "reversed") return false;
  return true;
}

function matchesSettlementFilters(item, thresholdFilter, settledFilter) {
  if (thresholdFilter && Number(item.threshold || 0) !== thresholdFilter) return false;
  if (settledFilter === "settled" && item.status !== "settled") return false;
  if (settledFilter === "reversed" && item.status !== "reversed") return false;
  if (settledFilter === "unsettled") return false;
  return true;
}

function serializeSettlement(state, settlement) {
  const user = (state.users || []).find((item) => item.id === settlement.userId);
  return {
    id: settlement.id,
    monthKey: settlement.monthKey,
    userId: settlement.userId,
    nickname: user?.nickname || settlement.nickname || settlement.userId,
    threshold: settlement.threshold,
    rewardPoints: settlement.rewardPoints,
    totalPoints: settlement.totalPoints,
    idempotencyKey: settlement.idempotencyKey,
    status: settlement.reversedAt ? "reversed" : "settled",
    createdAt: settlement.createdAt || "",
    reversedAt: settlement.reversedAt || "",
    reversalReason: settlement.reversalReason || "",
    reversedByRoleId: settlement.reversedByRoleId || ""
  };
}

function appendOperation(state, actor, action, targetId, detail = {}) {
  state.adminOperationLogs ||= [];
  state.adminOperationLogs.unshift({
    id: nextId("op"),
    adminId: actor?.adminId || null,
    roleId: actor?.role?.id || actor?.id || "system",
    action,
    targetType: "monthly_reward",
    targetId,
    reason: normalizeReason(detail.reason),
    detail,
    idempotencyKey: `monthly_reward:${targetId}:${Date.now()}`,
    before: {},
    after: detail,
    createdAt: new Date().toISOString()
  });
}

module.exports = {
  DEFAULT_RULES,
  buildMonthlyPointRewardOverview,
  getMonthlyPointRewardRules,
  normalizeMonthlyPointRewardRules,
  reverseMonthlyPointReward,
  settleMonthlyPointRewards
};
