const { request } = require("../../utils/api");

Page({
  data: {
    orders: []
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const orders = await request("/api/orders");
      this.setData({ orders });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  }
});
