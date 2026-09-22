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
  },

  onShow(options = {}) { this.captureInvite(options); },
  captureInvite(options) {
    if (options.query?.inviteCode) wx.setStorageSync("tgg_pending_invite", options.query.inviteCode);
  }
});
