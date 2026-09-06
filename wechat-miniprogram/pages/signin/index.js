const { request } = require("../../utils/api");

Page({
  data: {
    status: null,
    loading: false
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const status = await request("/api/signin/status");
      this.setData({ status });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async startSignin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const session = await request("/api/signin/start", { method: "POST", data: {} });
      const total = (session.adGroups || 0) * 2;
      for (let i = 0; i < total; i += 1) {
        await request("/api/signin/ad_complete", {
          method: "POST",
          data: { sessionId: session.sessionId }
        });
      }
      wx.showToast({ title: "签到完成", icon: "success" });
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async spinLottery() {
    try {
      const prize = await request("/api/signin/lottery_spin", { method: "POST", data: {} });
      wx.showToast({ title: prize.label || "抽奖完成", icon: "none" });
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  }
});
