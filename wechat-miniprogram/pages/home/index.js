const { request } = require("../../utils/api");

Page({
  data: {
    home: { user: {}, recommendProducts: [] }
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const home = await request("/api/home");
      this.setData({ home });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  goTasks() {
    wx.switchTab({ url: "/pages/tasks/index" });
  },

  openProduct(e) {
    wx.navigateTo({ url: `/pages/task-detail/index?id=${e.currentTarget.dataset.id}&type=product` });
  }
});
