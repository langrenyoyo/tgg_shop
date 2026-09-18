const { request } = require("../../utils/api");
const { playAd } = require("../../utils/ad-playback");

Page({
  data: {
    status: null,
    loading: false, refreshing: false, session: null, error: ""
  },

  onShow() {
    this.disposed = false;
    this.load();
  },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; this.playback?.cancel(); },
  active(owner = this.ownerId) { return !this.disposed && Boolean(owner && owner === this.ownerId && owner === wx.getStorageSync("tgg_user")?.id && wx.getStorageSync("tgg_token")); },
  canAct() {
    if (!this.active()) { if (!this.disposed) this.load(); return false; }
    return !this.data.loading && !this.data.refreshing && !this.data.error && Boolean(this.data.status);
  },
  login() { wx.navigateTo({ url: "/pages/login/index" }); },

  async load() {
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (this.ownerId !== owner) this.playback?.cancel();
    this.ownerId = owner;
    this.setData({ status: null, session: null, error: "", refreshing: false });
    if (!this.active(owner)) { if (!this.disposed) this.setData({ error: "请登录后查看签到" }); return; }
    this.setData({ refreshing: true });
    try {
      const status = await request("/api/signin/status");
      if (version === this.version && this.active(owner)) this.setData({ status, session: status.sessionId ? status : null });
    } catch (error) {
      if (version === this.version && this.active(owner)) this.setData({ error: error.message });
    } finally { if (version === this.version && !this.disposed) this.setData({ refreshing: false }); }
  },

  async startSignin() {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    if (this.data.status?.adRewardsAvailable === false) return;
    this.setData({ loading: true });
    try {
      const session = await request("/api/signin/start", { method: "POST", data: {} });
      if (!this.active(owner)) return;
      this.setData({ status: { ...this.data.status, ...session }, session });
      wx.showToast({ title: "请按提示完成广告", icon: "none" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      if (!this.disposed) this.setData({ loading: false });
    }
  },

  async adComplete(session, owner = this.ownerId) {
    if (!this.active(owner)) return;
    if (!session?.currentAdType || !session?.completionToken) throw new Error("请先开始签到");
    try {
      const result = await request("/api/signin/ad_complete", { method: "POST", data: { sessionId: session.sessionId, adType: session.currentAdType, completionToken: session.completionToken } });
      if (!this.active(owner)) return;
      this.setData({ session: { ...session, ...result }, status: { ...this.data.status, ...result } });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { if (this.active(owner)) await this.load(); }
  },

  async playAd() {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    const session = this.data.session;
    if (this.data.status?.adRewardsAvailable === false) return;
    if (!session || session.signedToday) return;
    const type = session.currentAdType;
    const cfg = wx.getStorageSync("tgg_config") || {};
    const adUnitId = type === "reward_video" ? cfg.rewardedAdUnitId : cfg.interstitialAdUnitId;
    if (!adUnitId) return wx.showToast({ title: "广告位尚未配置", icon: "none" });
    this.setData({ loading: true });
    try {
      this.playback = playAd(wx, type, adUnitId);
      await this.playback.promise;
      if (this.active(owner)) await this.adComplete(session, owner);
    } catch (error) { if (!this.disposed) wx.showToast({ title: error.message || "广告未完成", icon: "none" }); }
    finally { this.playback = null; if (!this.disposed) this.setData({ loading: false }); }
  },

  async spinLottery() {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    this.setData({ loading: true });
    try {
      const prize = await request("/api/signin/lottery_spin", { method: "POST", data: {} });
      if (!this.active(owner)) return;
      wx.showToast({ title: prize.label || "抽奖完成", icon: "none" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally { if (!this.disposed) this.setData({ loading: false }); }
  }
});
