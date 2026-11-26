// Native lifecycle report; the server binds it to an issued step token.
function adFailure(result = {}) {
  const code = Number(result?.errCode ?? result?.code);
  const messages = {
    1000: '微信广告服务暂不可用', 1001: '广告参数错误', 1002: '广告位无效，请联系客服',
    1003: '微信广告服务内部错误', 1004: '微信暂未返回可展示广告', 1005: '广告位正在审核',
    1006: '广告位审核未通过', 1007: '广告能力暂被限制', 1008: '广告位已关闭',
    2001: '微信限制启动后立即展示插屏', 2002: '距离上次广告播放时间过短，微信暂不允许展示插屏',
    2003: '微信广告尚未完全关闭', 2004: '广告渲染失败', 2005: '广告页面已变化'
  };
  const wait = [2001, 2002, 2003].includes(code) ? 60 : [1000, 1003, 1004].includes(code) ? 30 : 0;
  return Object.assign(new Error(`${messages[code] || '广告暂不可用'}${Number.isFinite(code) ? `（${code}）` : ''}，已完成步骤已保留${wait ? `，请等待 ${wait} 秒后重试` : '，请稍后重试'}`),
    { adCode: Number.isFinite(code) ? code : null, retryAfterSeconds: wait });
}
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
    const failed = result => finish(adFailure(result));
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
