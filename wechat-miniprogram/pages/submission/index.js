const { request } = require("../../utils/api");
Page({
  data: { submission: null, error: "", loading: false },
  onLoad(query) { this.id = query.id; },
  onShow() { this.load(); },
  onUnload() { this.loadVersion = (this.loadVersion || 0) + 1; },
  refresh() { return this.load(this.data.submission?.platform === "bounty_platform"); },
  async load(sync = false) {
    const previous = sync === true ? this.data.submission : null;
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    this.setData({ submission: null, error: "", loading: false });
    if (!owner || !wx.getStorageSync("tgg_token")) { this.setData({ error: "请登录后查看提交记录" }); return; }
    if (!this.id) { this.setData({ error: "缺少提交单编号，请从提交记录重新进入" }); return; }
    const current = () => version === this.loadVersion && owner === wx.getStorageSync("tgg_user")?.id;
    this.setData({ loading: true });
    try {
      const submission = await request("/api/submissions/" + encodeURIComponent(this.id) + (sync === true ? "/sync" : ""), sync === true ? { method: "POST", data: {} } : {});
      if (current()) this.setData({ submission, error: "" });
    } catch (error) {
      if (current()) this.setData({ submission: previous, error: error.message });
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  openTask() {
    const taskId = this.data.submission?.taskId;
    if (taskId) wx.navigateTo({ url: "/pages/task-detail/index?id=" + encodeURIComponent(taskId) });
  },
  openRecords() {
    wx.setStorageSync("tgg_task_view", "submissions");
    wx.switchTab({ url: "/pages/tasks/index" });
  },
  goLogin() { wx.navigateTo({ url: "/pages/login/index" }); }
});
