const { request, clearSession, resolveAssetUrl } = require("../../utils/api");

Page({
  data: {
    user: {}, avatarPreview: "", error: "", authNotice: "", loading: false, loggingOut: false, loggedIn: false
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
    this.setData({ user: {}, avatarPreview: "", error: "", authNotice: "", loading: loggedIn, loggedIn });
    if (!loggedIn) return;
    try {
      const user = await request("/api/me");
      if (!active() || owner !== wx.getStorageSync("tgg_user")?.id) return;
      if (user.id !== owner) throw new Error("账号信息不一致，请重新登录");
      this.setData({ user, avatarPreview: user.avatarUrl ? resolveAssetUrl(user.avatarUrl) : "", error: "" });
      wx.setStorageSync("tgg_user", user);
    } catch (error) {
      if (!active()) return;
      const currentOwner = wx.getStorageSync("tgg_user")?.id;
      if (currentOwner && currentOwner !== owner) return;
      if (!wx.getStorageSync("tgg_token") || !currentOwner) {
        this.setData({ user: {}, avatarPreview: "", error: "", loggedIn: false, authNotice: "登录已失效，请重新登录后查看积分和订单" });
      } else {
        this.setData({ user: {}, avatarPreview: "", error: error.message });
      }
    } finally { if (active()) this.setData({ loading: false, loggedIn: Boolean(wx.getStorageSync("tgg_token") && wx.getStorageSync("tgg_user")?.id) }); }
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },
  editProfile() { wx.navigateTo({ url: "/pages/login/index?edit=1" }); },

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
    this.setData({ loggingOut: true, loading: false, user: {}, avatarPreview: "", error: "" });
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
