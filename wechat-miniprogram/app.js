App({
  globalData: {
    token: "",
    user: null,
    config: null
  },

  onLaunch() {
    const token = wx.getStorageSync("tgg_token") || "";
    const user = wx.getStorageSync("tgg_user") || null;
    const config = wx.getStorageSync("tgg_config") || null;
    this.globalData.token = token;
    this.globalData.user = user;
    this.globalData.config = config;
  }
});
