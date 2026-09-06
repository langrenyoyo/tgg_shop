const { request } = require("../../utils/api");

Page({
  data: {
    info: null,
    list: []
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const [info, list] = await Promise.all([
        request("/api/invite/info"),
        request("/api/invite/list")
      ]);
      this.setData({ info, list });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  copyCode() {
    if (!this.data.info?.inviteCode) return;
    wx.setClipboardData({
      data: this.data.info.inviteCode
    });
  }
});
