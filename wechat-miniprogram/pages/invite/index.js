const { request } = require("../../utils/api");

Page({
  data: {
    info: null,
    list: [], error: "", loading: false, page: 0, hasMore: false,
    codePath: "", codeError: "", generating: false, saving: false, albumDenied: false
  },

  onShow() {
    this.disposed = false;
    this.load();
  },

  onHide() { this.codeVersion = (this.codeVersion || 0) + 1; this.setData({ generating: false }); },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; this.resetCode(); },
  removeCodeFile(filePath) {
    if (filePath) wx.getFileSystemManager().unlink({ filePath, fail() {} });
  },
  resetCode() {
    this.codeVersion = (this.codeVersion || 0) + 1;
    this.removeCodeFile(this.data.codePath);
    this.setData({ codePath: "", codeError: "", generating: false, saving: false, albumDenied: false });
  },
  currentOwner() {
    return !this.disposed && this.ownerId && this.ownerId === wx.getStorageSync("tgg_user")?.id && Boolean(wx.getStorageSync("tgg_token"));
  },
  actionError(message) {
    this.setData({ codeError: message });
    wx.showToast({ title: message, icon: "none" });
  },
  checkActionOwner() {
    if (this.currentOwner()) return true;
    wx.showToast({ title: "登录状态已变化，请重新打开邀请页或登录", icon: "none" });
    this.load();
    return false;
  },
  async generateCode() {
    if (!this.checkActionOwner()) return;
    if (this.data.generating) return;
    if (!this.data.info?.inviteCode) {
      const owner = this.ownerId;
      await this.load();
      if (!this.currentOwner() || owner !== this.ownerId) return;
      if (!this.data.info?.inviteCode) return this.actionError(this.data.error || "邀请码暂不可用，请刷新重试或联系客服");
    }
    const owner = this.ownerId, code = this.data.info.inviteCode;
    const version = this.codeVersion = (this.codeVersion || 0) + 1;
    const current = () => this.currentOwner() && this.ownerId === owner && version === this.codeVersion;
    this.setData({ generating: true, codeError: "" });
    let filePath = "";
    try {
      const result = await request("/api/invite/code", { authRequired: true });
      if (!current()) return;
      if (result.userId !== owner || result.inviteCode !== code || !["image/png", "image/jpeg"].includes(result.mimeType) || typeof result.imageBase64 !== "string" || !result.imageBase64 || result.imageBase64.length > 1400000) throw new Error("小程序码信息异常，请重新生成");
      filePath = `${wx.env.USER_DATA_PATH}/invite-${Date.now()}-${version}.${result.mimeType === "image/png" ? "png" : "jpg"}`;
      await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath, data: result.imageBase64, encoding: "base64", success: resolve, fail: reject }));
      if (!current()) { this.removeCodeFile(filePath); return; }
      this.removeCodeFile(this.data.codePath);
      this.setData({ codePath: filePath });
    } catch (error) {
      this.removeCodeFile(filePath);
      if (!this.disposed && version === this.codeVersion) this.actionError(error.message || "小程序码图片保存失败，请重试");
    } finally { if (!this.disposed && version === this.codeVersion) this.setData({ generating: false }); }
  },
  async saveCode() {
    if (!this.currentOwner()) { this.resetCode(); this.load(); return; }
    if (!this.data.codePath || this.data.saving) return;
    const owner = this.ownerId;
    const current = () => this.currentOwner() && this.ownerId === owner;
    this.setData({ saving: true, codeError: "", albumDenied: false });
    try {
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: this.data.codePath, success: resolve, fail: reject }));
      if (current()) wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (error) {
      if (current()) {
        const denied = /auth deny|auth denied|authorize|permission/i.test(error.errMsg || "");
        this.setData({ albumDenied: denied, codeError: denied ? "请在设置中允许保存到相册，再点击保存" : /cancel/i.test(error.errMsg || "") ? "已取消保存，可重新保存" : "保存失败，请检查相册权限后重试" });
      }
    } finally { if (current()) this.setData({ saving: false }); }
  },
  previewCode() { if (this.currentOwner() && this.data.codePath) wx.previewImage({ urls: [this.data.codePath], current: this.data.codePath }); },
  async load(append = false) {
    append = append === true;
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (owner !== this.ownerId || !wx.getStorageSync("tgg_token")) { append = false; this.resetCode(); }
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
      if (current()) {
        if (this.codeInvite && this.codeInvite !== info.inviteCode) this.resetCode();
        this.codeInvite = info.inviteCode;
        this.setData({ info, list: append ? this.data.list.concat(result.rows) : result.rows, page, hasMore: page * result.count < result.total });
      }
    } catch (error) {
      if (current()) this.setData({ error: error.message });
    } finally { if (version === this.version) this.setData({ loading: false }); }
  },
  more() { if (this.data.hasMore && !this.data.loading) this.load(true); },
  goLogin() { wx.navigateTo({ url: "/pages/login/index" }); },

  async copyCode() {
    if (!this.checkActionOwner()) return;
    if (!this.data.info?.inviteCode) {
      const owner = this.ownerId;
      await this.load();
      if (!this.currentOwner() || owner !== this.ownerId) return;
      if (!this.data.info?.inviteCode) return this.actionError(this.data.error || "邀请码暂不可用，请刷新重试或联系客服");
    }
    const owner = this.ownerId;
    this.setData({ codeError: "" });
    try {
      await new Promise((resolve, reject) => wx.setClipboardData({ data: this.data.info.inviteCode, success: resolve, fail: reject }));
      if (this.currentOwner() && this.ownerId === owner) wx.showToast({ title: "邀请码已复制", icon: "success" });
    } catch (error) {
      if (this.currentOwner() && this.ownerId === owner) this.actionError("复制失败，请重试或长按邀请码复制");
    }
  },
  onShareAppMessage() {
    const code = this.ownerId && this.ownerId === wx.getStorageSync("tgg_user")?.id && wx.getStorageSync("tgg_token") ? this.data.info?.inviteCode : "";
    return {
      title: "好友邀你来赚积分，快打开看看看~吧~",
      path: "/pages/home/index" + (code ? "?inviteCode=" + encodeURIComponent(code) : ""),
      imageUrl: "/assets/invite-share.png"
    };
  }
});
