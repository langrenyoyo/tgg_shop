const { request } = require("../../utils/api");

Page({
  data: {
    ledger: []
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const ledger = await request("/api/points-ledger");
      this.setData({ ledger });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  }
});
