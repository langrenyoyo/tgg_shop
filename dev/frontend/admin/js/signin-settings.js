export function signinSettings(state, escape, can) {
  const c = { enabled: false, minRounds: 2, maxRounds: 4, intervalSeconds: 5, rewardCoins: 10, sequence: ["interstitial", "rewarded", "interstitial"], ...(state.config?.coinSignin || {}) };
  const input = (label, key, min, max) => `<label>${label}<input type="number" name="${key}" min="${min}" max="${max}" step="1" required value="${escape(c[key])}"></label>`;
  return `<section class="panel"><div class="panel-head"><h2>签到设置</h2><span>金币独立记账 · 不兑换积分或提现</span></div>
    ${state.configError ? `<p role="alert">${escape(state.configError)}</p>` : ""}
    <div class="note">服务端广告验证：${state.config?.coinSigninVerificationReady ? "已配置，需联调确认真实广告凭据" : "尚未配置，签到暂不可用"}。尚未开通微信流量主时请保持关闭；不会使用模拟广告发奖。</div>
    <form class="config-form" data-config-form="coinSignin"><fieldset class="settings-group" ${!can("config:write") || state.configError ? "disabled" : ""}>
    <label class="check"><input type="checkbox" name="enabled" ${c.enabled ? "checked" : ""}>开启金币签到</label>
    ${input("最少轮数（包含下限）", "minRounds", 1, 10)}${input("最多轮数（包含上限）", "maxRounds", 1, 10)}
    ${input("轮间倒计时 / 秒", "intervalSeconds", 0, 300)}${input("签到固定奖励 / 金币", "rewardCoins", 1, 100000)}
    <label>每轮广告顺序<textarea name="sequence" rows="3" required>${escape(c.sequence.join(","))}</textarea><small>按先后顺序填写：interstitial 为插屏，rewarded 为激励视频。默认 interstitial,rewarded,interstitial；1–6 个，至少包含一个激励。</small></label>
    ${[["bannerAdUnitId", "横幅广告位"], ["feedAdUnitId", "信息流广告位"], ["interstitialAdUnitId", "插屏广告位"], ["rewardedAdUnitId", "激励视频广告位"]].map(([key, label]) => `<label>${label}<input name="${key}" maxlength="71" placeholder="adunit-…（未开通可留空）" value="${escape(c[key] || "")}"></label>`).join("")}
    <p class="note">开始签到时由服务器在范围内随机确定轮数；刷新、退出和重试均不重抽。仅完整完成一组才计入一轮，未完成组重新开始；全部完成后点击“完成签到”领取一次金币。新配置仅影响新签到，关闭活动会暂停继续观看；已完成全部轮数仍可领取。</p>
    <button class="action" type="submit">保存签到设置</button></fieldset></form></section>`;
}
