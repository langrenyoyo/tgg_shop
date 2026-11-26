// Native lifecycle report; the server binds it to an issued step token.
function showSigninAd(step) {
  let ad, timer, settled = false, cancel;
  const promise = new Promise((resolve, reject) => {
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      ad?.offClose?.(closed); ad?.offError?.(failed); ad?.destroy?.();
      error ? reject(error) : resolve(result);
    };
    const closed = result => finish(step.type === "rewarded" && result?.isEnded !== true ? new Error("激励视频未完整观看，本轮未完成") : null,
      { closed: true, isEnded: step.type === 'rewarded' ? result?.isEnded === true : undefined });
    const failed = () => finish(new Error("广告暂不可用，已完成轮数已保留，请稍后重试"));
    cancel = () => finish(new Error("本轮已中断，已完成轮数已保留"));
    try {
      if (!step.adUnitId) return finish(new Error("广告位尚未配置"));
      if (step.type === "rewarded" && wx.createRewardedVideoAd) ad = wx.createRewardedVideoAd({ adUnitId: step.adUnitId, multiton: true });
      else if (step.type === "interstitial" && wx.createInterstitialAd) ad = wx.createInterstitialAd({ adUnitId: step.adUnitId });
      else return finish(new Error("当前微信版本不支持该广告，请更新微信"));
      ad.onClose(closed); ad.onError(failed);
      timer = setTimeout(failed, 10 * 60000);
      Promise.resolve(ad.load()).then(() => { if (!settled) return ad.show(); }).catch(failed);
    } catch { failed(); }
  });
  return { promise, cancel() { cancel(); } };
}
module.exports = { showSigninAd };
