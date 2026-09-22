const { request, saveStationSession, clearStationSession } = require("../../utils/station-api");

Page({
  data: { username: "", password: "", error: "", loading: false, binding: false },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  wxCode() {
    return new Promise((resolve, reject) => wx.login({ success: result => result.code ? resolve(result.code) : reject(new Error("微信未返回登录凭证")), fail: reject }));
  },
  async wechatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try {
      const result = await request("/api/station/auth/wechat-login", { method: "POST", data: { code: await this.wxCode() }, retry: false });
      saveStationSession(result);
      wx.reLaunch({ url: "/pages/station/index" });
    } catch (error) {
      this.setData({ error: error.message || "微信授权失败" });
    } finally { this.setData({ loading: false }); }
  },
  async bindWechat() {
    if (this.data.binding) return;
    if (!this.data.username.trim() || !this.data.password) return this.setData({ error: "请输入站点账号和密码" });
    this.setData({ binding: true, error: "" });
    try {
      const login = await request("/api/station/auth/login", { method: "POST", data: { username: this.data.username.trim(), password: this.data.password }, retry: false });
      saveStationSession(login);
      await request("/api/station/auth/bind-wechat", { method: "POST", data: { code: await this.wxCode() }, retry: false });
      wx.reLaunch({ url: "/pages/station/index" });
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) clearStationSession();
      this.setData({ error: error.message || "绑定失败" });
    } finally { this.setData({ binding: false }); }
  }
});
