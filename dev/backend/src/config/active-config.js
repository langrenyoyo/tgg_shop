const retiredAdKeys = new Set([
  "splashAdEnabled", "signinAdMaterials", "signinAdGroupMin", "signinAdGroupMax",
  "signinStreakDays", "signinStreakRewardPoints", "signinStreakRewardText",
  "lotteryDailyLimit", "lotteryPrizes", "rewardedAdUnitId", "interstitialAdUnitId"
]);

// Public clients receive an explicit contract. Integration state, provider
// mappings and future internal config must never become public by accident.
const publicConfigKeys = new Set([
  "membershipMonthlyPrice", "membershipMonthlyPoints", "membershipPointCashRate",
  "pickupEnabled", "deliveryEnabled", "deliveryFeeEnabled", "deliveryFee",
  "deliveryFreeThreshold", "deliveryFeeTiers", "deliveryCutoffHour",
  "deliveryTimeSlots", "deliveryTimeZone", "deliveryServiceAreaKeywords",
  "deliveryRequireSavedAddress", "cashOrderMaxAmount", "cashDailyMaxAmount",
  "stationPickingEnabled", "stationBatchPickingEnabled", "stationScanRequired",
  "stationSortMode", "stationPickupHoldHours", "stationShelfPrefix",
  "rankingRefreshMinutes", "dailySigninRewardPoints", "inviteRewardPoints", "inviteCommissionRate",
  "monthlyPointRewardEnabled", "monthlyPointRewardSettlementHour",
  "monthlyPointRewardSettlementMinute", "monthlyPointRewardRules",
  "homeBannerTitle", "homeBannerSubtitle", "homeBannerProductId",
  "homeBannerImage", "homeCarouselImages", "homeServiceBadges", "homeCategoryShortcuts",
  "homePromotionEntries", "homeDeliveryPromise", "purePointsNoCashTopup",
  "withdrawMinAmount", "withdrawFeeRate", "withdrawDailyCountLimit",
  "withdrawDailyAmountLimit", "paymentTimeoutMinutes", "autoConfirmDeliveryDays"
]);

// Filter responses while preserving stored historical configuration for audit.
function activeConfig(config) {
  const result = Object.fromEntries(Object.entries(config).filter(([key]) => publicConfigKeys.has(key) && !retiredAdKeys.has(key)));
  if (Array.isArray(result.homePromotionEntries)) result.homePromotionEntries = result.homePromotionEntries.filter(item => item.page !== "signin");
  return result;
}

module.exports = { activeConfig, publicConfigKeys, retiredAdKeys };
