const { wechatLogin } = require("../../utils/auth");
const { request, uploadFile, resolveAssetUrl } = require("../../utils/api");

function phoneAuthorizationError(detail = {}) {
  const message = String(detail.errMsg || "");
  if (Number(detail.errno) === 112 || /not declared|privacy agreement/i.test(message)) {
    return "手机号授权暂不可用：小程序隐私保护指引中的手机号声明尚未生效，请联系客服";
  }
  if (/deny|cancel/i.test(message)) return "你已取消手机号授权，可重新点击授权，并在窗口中选择手机号";
  return "未获取到手机号授权，请在最新版微信中重试；如持续失败请联系客服";
}

Page({
  data: {
    loading: false, agreed: false, stage: "login", nickname: "",
    avatarPreview: "", error: "", editing: false, selectingAvatar: false, maskedPhone: "", invalidInvite: ""
  },

  onLoad(query = {}) {
    this.disposed = false;
    this.setData({ editing: query.edit === "1" });
    const user = wx.getStorageSync("tgg_user");
    if (wx.getStorageSync("tgg_token") && user?.id) {
      this.ownerId = user.id;
      if (!user.phone && !this.data.editing) this.setData({ stage: "phone" });
      else this.openProfile(user);
    }
  },
  onUnload() { this.disposed = true; },
  clearInvite() {
    if (this.data.loading) return;
    if (this.data.invalidInvite && wx.getStorageSync("tgg_pending_invite") === this.data.invalidInvite) wx.removeStorageSync("tgg_pending_invite");
    this.setData({ invalidInvite: "", error: "" });
  },
  onConsentChange(e) { if (!this.data.loading) this.setData({ agreed: e.detail.value.includes("agree") }); },
  openPrivacy() {
    if (!wx.openPrivacyContract) return wx.showToast({ title: "请升级微信后查看隐私保护指引", icon: "none" });
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: "隐私保护指引暂不可用，请稍后重试", icon: "none" }) });
  },

  async handleLogin(e) {
    if (this.disposed || this.data.loading) return;
    if (!this.data.agreed) return wx.showToast({ title: "请先阅读并同意登录授权说明", icon: "none" });
    const phoneCode = e?.detail?.code;
    if (!phoneCode) return this.setData({ error: phoneAuthorizationError(e?.detail) });
    this.setData({ loading: true, error: "" });
    let attemptedInvite = "";
    try {
      if (wx.requirePrivacyAuthorize) {
        await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({
          success: resolve, fail: () => reject(new Error("未获得隐私授权，未继续登录"))
        }));
      }
      if (this.disposed) return;
      attemptedInvite = wx.getStorageSync("tgg_pending_invite") || "";
      const res = await wechatLogin({ isCurrent: () => !this.disposed, phoneCode });
      if (this.disposed) return;
      this.openProfile(res.user);
      if (res.user.avatarUrl && res.user.nickname && res.user.nickname !== "微信用户") this.finish();
    } catch (error) {
      if (!this.disposed) this.setData({ error: error.message || "登录失败，请重试", invalidInvite: /邀请码无效/.test(error.message || "") ? attemptedInvite : "" });
    } finally {
      if (!this.disposed) this.setData({ loading: false });
    }
  },
  async bindPhone(e) {
    if (this.data.loading || !this.isCurrentUser()) return;
    if (!e.detail?.code) return this.setData({ error: phoneAuthorizationError(e?.detail) });
    const wasEditing = this.data.stage === "profile";
    this.setData({ loading: true, error: "" });
    try {
      const user = await request("/api/me/phone", { method: "POST", data: { phoneCode: e.detail.code } });
      if (!this.isCurrentUser()) return;
      if (user.id !== this.ownerId) throw new Error("账号信息不一致，请重新登录");
      wx.setStorageSync("tgg_user", user);
      getApp().globalData.user = user;
      if (wasEditing) {
        this.setData({ maskedPhone: this.maskPhone(user.phone) });
      } else {
        this.openProfile(user);
        if (user.avatarUrl && user.nickname && user.nickname !== "微信用户") this.finish();
      }
    } catch (error) { if (this.isCurrentUser()) this.setData({ error: error.message || "绑定失败，请重试" }); }
    finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  maskPhone(phone) { return /^1\d{10}$/.test(String(phone || "")) ? String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2") : ""; },
  openProfile(user) {
    this.ownerId = user.id;
    this.avatarPath = user.avatarUrl || "";
    this.avatarTemp = "";
    this.setData({ stage: "profile", nickname: user.nickname === "微信用户" ? "" : user.nickname || "", avatarPreview: resolveAssetUrl(this.avatarPath), maskedPhone: this.maskPhone(user.phone), error: "" });
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
  async chooseAvatarFromAlbum() {
    if (this.data.loading || this.data.selectingAvatar || !this.isCurrentUser()) return;
    const owner = this.ownerId;
    this.setData({ selectingAvatar: true, error: "" });
    try {
      if (wx.requirePrivacyAuthorize) await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }));
      if (!this.isCurrentUser() || owner !== this.ownerId) return;
      const file = await new Promise((resolve, reject) => {
        if (wx.chooseMedia) wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["compressed"], success: r => resolve(r.tempFiles?.[0]?.tempFilePath), fail: reject });
        else if (wx.chooseImage) wx.chooseImage({ count: 1, sourceType: ["album", "camera"], sizeType: ["compressed"], success: r => resolve(r.tempFilePaths?.[0]), fail: reject });
        else reject(new Error("请升级微信后选择头像"));
      });
      if (!this.isCurrentUser() || owner !== this.ownerId) return;
      if (!file) throw new Error("未获取到图片，请重新选择");
      this.onChooseAvatar({ detail: { avatarUrl: file } });
    } catch (error) {
      if (this.isCurrentUser() && owner === this.ownerId && !/cancel/i.test(error.errMsg || error.message || "")) this.setData({ error: "无法打开相册，请检查微信的相册权限后重试" });
    } finally { if (!this.disposed) this.setData({ selectingAvatar: false }); }
  },
  onNicknameInput(e) { if (!this.data.loading) this.setData({ nickname: e.detail.value }); },
  async saveProfile(e) {
    if (this.disposed || this.data.loading || this.data.selectingAvatar) return;
    if (!this.isCurrentUser()) return this.setData({ error: "登录状态已变化，请重新打开页面" });
    const nickname = String(e?.detail?.value?.nickname ?? this.data.nickname).trim();
    if (!nickname || [...nickname].length > 32) return this.setData({ error: "请填写 1 至 32 个字符的昵称" });
    if (!this.avatarTemp && !this.avatarPath) return this.setData({ error: "请选择头像，或点击稍后完善" });
    this.setData({ loading: true, nickname, error: "" });
    let step = "资料保存";
    try {
      if (this.avatarTemp) {
        step = "头像上传";
        const file = await uploadFile(this.avatarTemp);
        if (!this.isCurrentUser()) return;
        const absolute = file.path || file.url;
        const match = typeof absolute === "string" && absolute.match(/^https?:\/\/[^/]+(\/uploads\/[a-zA-Z0-9._-]+)$/);
        if (!match) throw new Error("头像上传地址无效，请重新选择");
        this.avatarPath = match[1];
        this.avatarTemp = "";
      }
      if (!this.isCurrentUser()) return;
      step = "资料保存";
      const user = await request("/api/me", { method: "PATCH", data: { nickname, avatarUrl: this.avatarPath } });
      if (!this.isCurrentUser()) return;
      if (user.id !== this.ownerId) throw new Error("账号信息不一致，请重新登录");
      wx.setStorageSync("tgg_user", user);
      getApp().globalData.user = user;
      this.finish();
    } catch (error) {
      if (this.isCurrentUser()) {
        const message = error.statusCode >= 500
          ? `${step}失败（${error.statusCode}），服务器暂时无法处理，请稍后重试`
          : error.message || `${step}失败，请重试`;
        this.setData({ error: message });
      }
    } finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  skipProfile() { if (!this.data.loading && !this.data.selectingAvatar && this.isCurrentUser()) this.finish(); },
  finish() {
    if (this.disposed) return;
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: "/pages/home/index" }) });
    else wx.reLaunch({ url: "/pages/home/index" });
  }
});
