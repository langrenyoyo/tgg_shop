const { wechatLogin } = require("../../utils/auth");
const { request, uploadFile, resolveAssetUrl } = require("../../utils/api");

Page({
  data: {
    loading: false, agreed: false, stage: "login", nickname: "",
    avatarPreview: "", error: "", editing: false
  },

  onLoad(query = {}) {
    this.disposed = false;
    this.setData({ editing: query.edit === "1" });
    if (wx.getStorageSync("tgg_token") && wx.getStorageSync("tgg_user")?.id) this.openProfile(wx.getStorageSync("tgg_user"));
  },
  onUnload() { this.disposed = true; },
  onConsentChange(e) { if (!this.data.loading) this.setData({ agreed: e.detail.value.includes("agree") }); },
  openPrivacy() {
    if (!wx.openPrivacyContract) return wx.showToast({ title: "请升级微信后查看隐私保护指引", icon: "none" });
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: "隐私保护指引暂不可用，请稍后重试", icon: "none" }) });
  },

  async handleLogin() {
    if (this.disposed || this.data.loading) return;
    if (!this.data.agreed) return wx.showToast({ title: "请先阅读并同意登录授权说明", icon: "none" });
    this.setData({ loading: true, error: "" });
    try {
      if (wx.requirePrivacyAuthorize) {
        await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({
          success: resolve, fail: () => reject(new Error("未获得隐私授权，未继续登录"))
        }));
      }
      if (this.disposed) return;
      const res = await wechatLogin({ isCurrent: () => !this.disposed });
      if (this.disposed) return;
      this.openProfile(res.user);
      if (res.user.avatarUrl && res.user.nickname && res.user.nickname !== "微信用户") this.finish();
    } catch (error) {
      if (!this.disposed) this.setData({ error: error.message || "登录失败，请重试" });
    } finally {
      if (!this.disposed) this.setData({ loading: false });
    }
  },
  openProfile(user) {
    this.ownerId = user.id;
    this.avatarPath = user.avatarUrl || "";
    this.avatarTemp = "";
    this.setData({ stage: "profile", nickname: user.nickname === "微信用户" ? "" : user.nickname || "", avatarPreview: resolveAssetUrl(this.avatarPath), error: "" });
  },
  isCurrentUser() {
    return !this.disposed && Boolean(wx.getStorageSync("tgg_token")) && this.ownerId === wx.getStorageSync("tgg_user")?.id;
  },
  onChooseAvatar(e) {
    if (this.data.loading || !this.isCurrentUser() || !e.detail.avatarUrl) return;
    this.avatarTemp = e.detail.avatarUrl;
    this.avatarPath = "";
    this.setData({ avatarPreview: this.avatarTemp, error: "" });
  },
  onNicknameInput(e) { if (!this.data.loading) this.setData({ nickname: e.detail.value }); },
  async saveProfile(e) {
    if (this.disposed || this.data.loading) return;
    if (!this.isCurrentUser()) return this.setData({ error: "登录状态已变化，请重新打开页面" });
    const nickname = String(e?.detail?.value?.nickname ?? this.data.nickname).trim();
    if (!nickname || [...nickname].length > 32) return this.setData({ error: "请填写 1 至 32 个字符的昵称" });
    if (!this.avatarTemp && !this.avatarPath) return this.setData({ error: "请选择头像，或点击稍后完善" });
    this.setData({ loading: true, nickname, error: "" });
    try {
      if (this.avatarTemp) {
        const file = await uploadFile(this.avatarTemp);
        if (!this.isCurrentUser()) return;
        const absolute = file.path || file.url;
        const match = typeof absolute === "string" && absolute.match(/^https?:\/\/[^/]+(\/uploads\/[a-zA-Z0-9._-]+)$/);
        if (!match) throw new Error("头像上传地址无效，请重新选择");
        this.avatarPath = match[1];
        this.avatarTemp = "";
      }
      if (!this.isCurrentUser()) return;
      const user = await request("/api/me", { method: "PATCH", data: { nickname, avatarUrl: this.avatarPath } });
      if (!this.isCurrentUser()) return;
      if (user.id !== this.ownerId) throw new Error("账号信息不一致，请重新登录");
      wx.setStorageSync("tgg_user", user);
      getApp().globalData.user = user;
      this.finish();
    } catch (error) {
      if (this.isCurrentUser()) this.setData({ error: error.message || "资料保存失败，请重试" });
    } finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  skipProfile() { if (!this.data.loading && this.isCurrentUser()) this.finish(); },
  finish() {
    if (this.disposed) return;
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: "/pages/home/index" }) });
    else wx.reLaunch({ url: "/pages/home/index" });
  }
});
