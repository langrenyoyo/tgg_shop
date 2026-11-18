const cart = require("./utils/cart");

App({
  globalData: {
    token: "",
    user: null,
    config: null,
    stationToken: "",
    station: null
  },

  onLaunch(options = {}) {
    this.captureInvite(options);
    const token = wx.getStorageSync("tgg_token") || "";
    const user = wx.getStorageSync("tgg_user") || null;
    const config = wx.getStorageSync("tgg_config") || null;
    this.globalData.token = token;
    this.globalData.user = user;
    this.globalData.config = config;
    this.globalData.stationToken = wx.getStorageSync("tgg_station_token") || "";
    this.globalData.station = wx.getStorageSync("tgg_station") || null;
    cart.syncTabBarBadge();
  },

  onShow(options = {}) {
    this.captureInvite(options);
    cart.syncTabBarBadge();
  },
  captureInvite(options) {
    const query = options.query || {};
    let code = query.inviteCode || query.scene;
    if (typeof code !== "string") return;
    try { code = decodeURIComponent(code); } catch { return; }
    if (code.startsWith("inviteCode=")) code = code.slice(11);
    if (/^[a-zA-Z0-9_-]{1,32}$/.test(code)) wx.setStorageSync("tgg_pending_invite", code);
  }
});
