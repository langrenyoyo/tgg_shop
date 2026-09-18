const { request } = require("../../utils/api");

Page({
  data: {
    info: null,
    list: [], error: "", loading: false, page: 0, hasMore: false
  },

  onShow() {
    this.load();
  },

  onUnload() { this.version = (this.version || 0) + 1; },
  async load(append = false) {
    append = append === true;
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (owner !== this.ownerId) append = false;
    this.ownerId = owner;
    if (!append) this.setData({ info: null, list: [], page: 0, hasMore: false });
    if (!owner || !wx.getStorageSync("tgg_token")) { this.setData({ loading: false, error: "请登录后查看邀请记录" }); return; }
    const current = () => version === this.version && owner === wx.getStorageSync("tgg_user")?.id;
    const page = append ? this.data.page + 1 : 1;
    this.setData({ loading: true, error: "" });
    try {
      const [info, result] = await Promise.all([
        request("/api/invite/info"),
        request(`/api/invite/list?page=${page}&count=20`)
      ]);
      if (current()) this.setData({ info, list: append ? this.data.list.concat(result.rows) : result.rows, page, hasMore: page * result.count < result.total });
    } catch (error) {
      if (current()) this.setData({ error: error.message });
    } finally { if (version === this.version) this.setData({ loading: false }); }
  },
  more() { if (this.data.hasMore && !this.data.loading) this.load(true); },
  goLogin() { wx.navigateTo({ url: "/pages/login/index" }); },

  copyCode() {
    if (!this.ownerId || this.ownerId !== wx.getStorageSync("tgg_user")?.id || !wx.getStorageSync("tgg_token")) { this.load(); return; }
    if (!this.data.info?.inviteCode) return;
    wx.setClipboardData({
      data: this.data.info.inviteCode
    });
  },
  onShareAppMessage() {
    const code = this.ownerId && this.ownerId === wx.getStorageSync("tgg_user")?.id && wx.getStorageSync("tgg_token") ? this.data.info?.inviteCode : "";
    return { title: "加入 TGG Shop，一起赚积分", path: "/pages/home/index" + (code ? "?inviteCode=" + encodeURIComponent(code) : "") };
  }
});
