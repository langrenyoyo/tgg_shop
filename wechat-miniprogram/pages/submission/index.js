const { request, resolveAssetUrl } = require("../../utils/api");
Page({
  data: { submission: null, proofImages: [], error: "", loading: false },
  onLoad(query) { this.id = query.id; },
  onShow() { this.load(); },
  onUnload() { this.ownerId = null; this.loadVersion = (this.loadVersion || 0) + 1; },
  refresh() { return this.load(this.data.submission?.platform === "bounty_platform"); },
  async load(sync = false) {
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    const previous = sync === true && this.ownerId === owner ? this.data.submission : null;
    const previousImages = previous ? this.data.proofImages : [];
    this.ownerId = owner;
    this.setData({ submission: null, proofImages: [], error: "", loading: false });
    if (!owner || !wx.getStorageSync("tgg_token")) { this.setData({ error: "请登录后查看提交记录" }); return; }
    if (!this.id) { this.setData({ error: "缺少提交单编号，请从提交记录重新进入" }); return; }
    const current = () => version === this.loadVersion && owner === wx.getStorageSync("tgg_user")?.id;
    this.setData({ loading: true });
    try {
      const submission = await request("/api/submissions/" + encodeURIComponent(this.id) + (sync === true ? "/sync" : ""), sync === true ? { method: "POST", data: {} } : {});
      if (current()) this.setData({ submission, proofImages: imagesFor(submission), error: "" });
    } catch (error) {
      if (current()) this.setData({ submission: previous, proofImages: previousImages, error: error.message });
    } finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  previewProof(e) {
    if (this.data.loading || !this.data.submission || this.ownerId !== wx.getStorageSync("tgg_user")?.id || !wx.getStorageSync("tgg_token")) return;
    const image = this.data.proofImages[Number(e.currentTarget.dataset.index)];
    if (!image) return;
    const owner = this.ownerId;
    wx.previewImage({ current: image.url, urls: this.data.proofImages.map(item => item.url),
      fail: () => { if (owner === this.ownerId && owner === wx.getStorageSync("tgg_user")?.id) wx.showToast({ title: "截图打开失败，请稍后重试", icon: "none" }); } });
  },
  proofError(e) {
    const { index, url } = e.currentTarget.dataset;
    if (this.data.proofImages[index]?.url !== url) return;
    this.setData({ [`proofImages[${index}].failed`]: true });
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

function imagesFor(submission) {
  let raw = submission?.proofImages ?? submission?.payload?.images;
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s*[,\n]\s*(?=(?:https?:)?\/\/|\/)/i) : [];
  const urls = values.filter(value => typeof value === "string").map(value => value.trim()).filter(value => value && !/[\x00-\x20<>"\\]/.test(value) && !/^(?!https?:\/\/)[a-z][a-z\d+.-]*:/i.test(value))
    .map(value => resolveAssetUrl(value)).filter(url => /^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(url));
  return [...new Set(urls)].map(url => ({ url, failed: false }));
}
