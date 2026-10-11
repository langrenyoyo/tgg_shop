const retiredAdKeys = new Set([
  "splashAdEnabled", "signinAdMaterials", "signinAdGroupMin", "signinAdGroupMax",
  "signinStreakDays", "signinStreakRewardPoints", "signinStreakRewardText",
  "lotteryDailyLimit", "lotteryPrizes", "rewardedAdUnitId", "interstitialAdUnitId"
]);

// Filter responses while preserving stored historical configuration for audit.
function activeConfig(config) {
  const result = Object.fromEntries(Object.entries(config).filter(([key]) => !retiredAdKeys.has(key)));
  if (Array.isArray(result.homePromotionEntries)) result.homePromotionEntries = result.homePromotionEntries.filter(item => item.page !== "signin");
  return result;
}

module.exports = { activeConfig, retiredAdKeys };
