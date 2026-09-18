const { request, clearSession } = require("../../utils/api");

Page({
  data: {
    user: {}, error: "", loading: false, loggingOut: false, loggedIn: false
  },

  onShow() {
    this.load();
  },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; },

  async load() {
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    const active = () => !this.disposed && version === this.version;
    const loggedIn = Boolean(wx.getStorageSync("tgg_token") && owner);
    this.setData({ user: {}, error: "", loading: loggedIn, loggedIn });
    if (!loggedIn) return;
    try {
      const user = await request("/api/me");
      if (!active() || owner !== wx.getStorageSync("tgg_user")?.id) return;
      if (user.id !== owner) throw new Error("账号信息不一致，请重新登录");
      this.setData({ user, error: "" });
      wx.setStorageSync("tgg_user", user);
    } catch (error) {
      if (active()) this.setData({ user: {}, error: error.message });
    } finally { if (active()) this.setData({ loading: false, loggedIn: Boolean(wx.getStorageSync("tgg_token")) }); }
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
  goMembership() { wx.navigateTo({ url: "/pages/membership/index" }); },

  goInvite() {
    wx.navigateTo({ url: "/pages/invite/index" });
  },

  async logout() {
    if (this.disposed || this.data.loggingOut) return;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (!owner || !wx.getStorageSync("tgg_token")) return this.goLogin();
    this.version = (this.version || 0) + 1;
    this.setData({ loggingOut: true, loading: false, user: {}, error: "" });
    try {
      await request("/api/auth/logout", { method: "POST", data: {} });
      if (this.disposed || owner !== wx.getStorageSync("tgg_user")?.id) return;
      clearSession();
      this.setData({ loggedIn: false });
      wx.reLaunch({ url: "/pages/login/index" });
    } catch (error) {
      if (!this.disposed && owner === wx.getStorageSync("tgg_user")?.id) this.setData({ error: error.message });
    } finally { if (!this.disposed) this.setData({ loggingOut: false }); }
  }
});
