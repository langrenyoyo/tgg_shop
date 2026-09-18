// Playback completion is client evidence only. Production rewards require
// independent verification by the provider on the server.
function playAd(wxApi, type, adUnitId) {
  const factory = type === "reward_video" ? wxApi.createRewardedVideoAd : type === "interstitial" ? wxApi.createInterstitialAd : null;
  if (!factory || !adUnitId) throw new Error("广告位尚未配置或当前微信版本不支持");
  const ad = factory.call(wxApi, { adUnitId });
  let finish;
  let finished = false;
  const promise = new Promise((resolve, reject) => {
    const close = result => finish(type === "reward_video" && !result?.isEnded ? new Error("请完整观看广告") : null);
    const error = () => finish(new Error("广告加载或播放失败，请重试"));
    finish = reason => {
      if (finished) return;
      finished = true;
      ad.offClose?.(close);
      ad.offError?.(error);
      ad.destroy?.();
      if (reason) reject(reason); else resolve();
    };
    ad.onClose(close);
    ad.onError(error);
    Promise.resolve().then(() => { if (!finished) return ad.show(); }).catch(async () => {
      if (finished) return;
      try { await ad.load(); if (!finished) await ad.show(); }
      catch { error(); }
    });
  });
  return { promise, cancel: () => finish(new Error("广告播放已取消")) };
}
module.exports = { playAd };
