const { request } = require("../../utils/api");

Page({
  data: {
    categories: [],
    tasks: [],
    currentCid: ""
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const [categories, tasks] = await Promise.all([
        request("/api/task-types"),
        request("/api/tasks?page=1&count=20" + (this.data.currentCid ? `&c_id=${this.data.currentCid}` : ""))
      ]);
      this.setData({ categories, tasks });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  reload() {
    this.load();
  },

  setCategory(e) {
    this.setData({ currentCid: e.currentTarget.dataset.id || "" }, () => this.load());
  },

  openTask(e) {
    wx.navigateTo({ url: `/pages/task-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  openInvite() {
    wx.switchTab({ url: "/pages/invite/index" });
  }
});
