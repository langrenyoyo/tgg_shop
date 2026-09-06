const { request } = require("../../utils/api");

Page({
  data: {
    user: {}
  },

  onShow() {
    this.setData({ user: wx.getStorageSync("tgg_user") || {} });
    this.load();
  },

  async load() {
    try {
      const user = await request("/api/me");
      this.setData({ user });
      wx.setStorageSync("tgg_user", user);
    } catch (error) {
      // ignore if not logged in
    }
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  goOrders() {
    wx.navigateTo({ url: "/pages/orders/index" });
  },

  goPoints() {
    wx.navigateTo({ url: "/pages/points/index" });
  },

  goInvite() {
    wx.switchTab({ url: "/pages/invite/index" });
  },

  logout() {
    wx.removeStorageSync("tgg_token");
    wx.removeStorageSync("tgg_user");
    wx.reLaunch({ url: "/pages/login/index" });
  }
});
