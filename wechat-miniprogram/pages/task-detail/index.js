const { request } = require("../../utils/api");

Page({
  data: {
    task: null
  },

  onLoad(query) {
    this.taskId = query.id;
    this.load();
  },

  async load() {
    try {
      const task = await request(`/api/tasks/${this.taskId}`);
      this.setData({ task });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  goSubmit() {
    wx.navigateTo({ url: `/pages/task-submit/index?id=${this.taskId}` });
  }
});
