const { request } = require("../../utils/api");

Page({
  data: {
    task: null, error: "", loading: false, busy: false
  },

  onLoad(query) {
    this.taskId = query.id;
  },
  onShow() { this.disposed = false; this.load(); },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; },

  async load() {
    const version = this.version = (this.version || 0) + 1;
    this.setData({ task: null, error: "", loading: false });
    if (!this.taskId) { this.setData({ error: "缺少任务编号，请从任务列表重新进入" }); return; }
    this.setData({ loading: true });
    try {
      const task = await request(`/api/tasks/${encodeURIComponent(this.taskId)}`);
      if (this.disposed || version !== this.version) return;
      this.setData({ task, error: "" });
    } catch (error) {
      if (!this.disposed && version === this.version) this.setData({ task: null, error: error.message });
    } finally { if (!this.disposed && version === this.version) this.setData({ loading: false }); }
  },

  async goSubmit() {
    if (this.disposed || this.data.loading || this.data.busy || !this.data.task || this.data.task.paused || this.data.task.rewardValid === false) return;
    if (!wx.getStorageSync("tgg_token")) return wx.navigateTo({ url: "/pages/login/index" });
    const owner = wx.getStorageSync("tgg_user")?.id;
    const version = this.version;
    const current = () => !this.disposed && version === this.version && owner === wx.getStorageSync("tgg_user")?.id;
    this.setData({ busy: true });
    try {
      const user = await request("/api/me");
      if (!current()) return;
      if (!user.isMember) return wx.navigateTo({ url: "/pages/membership/index" });
      wx.navigateTo({ url: `/pages/task-submit/index?id=${encodeURIComponent(this.taskId)}` });
    } catch (error) {
      if (!this.disposed && version === this.version && error.statusCode === 401 && !wx.getStorageSync("tgg_token")) { wx.navigateTo({ url: "/pages/login/index" }); return; }
      if (!current()) return;
      if (error.statusCode === 401) wx.navigateTo({ url: "/pages/login/index" });
      else wx.showToast({ title: error.message || "暂时无法核对会员状态，请重试", icon: "none" });
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  }
});
