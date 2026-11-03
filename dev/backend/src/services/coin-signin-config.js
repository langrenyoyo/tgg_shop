const defaults = Object.freeze({ enabled: false, minRounds: 2, maxRounds: 4, intervalSeconds: 5, rewardCoins: 10,
  sequence: ["interstitial", "rewarded", "interstitial"], bannerAdUnitId: "", feedAdUnitId: "", interstitialAdUnitId: "", rewardedAdUnitId: "" });
const adFields = ["bannerAdUnitId", "feedAdUnitId", "interstitialAdUnitId", "rewardedAdUnitId"];
function config(state) { return { ...defaults, ...(state.config.coinSignin || {}) }; }
function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "签到配置格式无效";
  if (Object.keys(value).some(key => !Object.hasOwn(defaults, key))) return "签到配置包含不支持的字段";
  if (typeof value.enabled !== "boolean") return "请选择签到开关";
  for (const [key, min, max] of [["minRounds", 1, 10], ["maxRounds", 1, 10], ["intervalSeconds", 0, 300], ["rewardCoins", 1, 100000]]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) return `${key} 须为 ${min} 至 ${max} 的整数`;
  }
  if (value.minRounds > value.maxRounds) return "最少轮数不能大于最多轮数";
  if (!Array.isArray(value.sequence) || !value.sequence.length || value.sequence.length > 6
    || value.sequence.some(type => !["interstitial", "rewarded"].includes(type)) || !value.sequence.includes("rewarded")) return "每轮须包含 1 至 6 个有序广告，且至少有一个激励视频";
  for (const key of adFields) if (typeof value[key] !== "string" || (value[key] && !/^adunit-[a-zA-Z0-9]{8,64}$/.test(value[key]))) return "广告位 ID 格式无效，请填写微信广告位 ID 或留空";
  if (value.enabled && (!value.rewardedAdUnitId || (value.sequence.includes("interstitial") && !value.interstitialAdUnitId))) return "开启前请配置所需的激励与插屏广告位";
  return null;
}
module.exports = { defaults, config, validate };
