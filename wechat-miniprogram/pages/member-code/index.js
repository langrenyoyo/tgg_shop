const { request } = require("../../utils/api");
const { draw } = require("../../utils/member-barcode");

Page({
  data: { loading: false, number: "", message: "", error: "", barcodeError: "", loggedIn: false, needsPhoneAuthorization: false },
  onShow() { this.visible = true; this.load(); },
  onHide() { this.clearCode(); },
  onUnload() { this.clearCode(); },
  clearCode() {
    this.visible = false;
    this.version = (this.version || 0) + 1;
    this.setData({ number: "", loading: false, barcodeError: "", needsPhoneAuthorization: false });
  },
  async load(options = {}) {
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    const token = wx.getStorageSync("tgg_token");
    const active = () => this.visible && version === this.version &&
      owner === wx.getStorageSync("tgg_user")?.id && token === wx.getStorageSync("tgg_token");
    this.setData({ number: "", message: "", error: "", barcodeError: "", needsPhoneAuthorization: false, loggedIn: Boolean(owner && token), loading: Boolean(owner && token) });
    if (!owner || !token) return;
    try {
      let result = await request("/api/me/member-code");
      if (!active()) return;
      if (result.canProvision) {
        this.setData({ needsPhoneAuthorization: Boolean(result.needsPhoneAuthorization) });
        if (options.phoneCode || !result.needsPhoneAuthorization) {
          this.setData({ needsPhoneAuthorization: false });
          result = await request("/api/me/member-code", { method: "POST", data: options.phoneCode ? { phoneCode: options.phoneCode } : {} });
          if (!active()) return;
        }
      }
      if (!result.available) { this.setData({ message: result.message || "尚未关联门店会员" }); return; }
      if (result.userId !== owner || result.format !== "CODE128") throw new Error("会员资料不一致，请重新登录");
      this.setData({ number: result.number, needsPhoneAuthorization: false }, () => {
        if (!active()) return;
        this.createSelectorQuery().select("#member-barcode").fields({ node: true, size: true }).exec(rows => {
          if (!active()) return;
          try {
            const target = rows[0];
            if (!target?.node || !target.width) throw new Error("会员码绘制失败，请重试");
            const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
            draw(target.node, result.number, target.width, target.height, info.pixelRatio || 1);
          } catch (error) { this.setData({ barcodeError: error.message }); }
        });
      });
    } catch (error) {
      if (this.visible && version === this.version) this.setData({ error: error.statusCode === 404
        ? "会员码服务尚未上线，请联系管理员更新服务后重试"
        : error.message, number: "", loggedIn: Boolean(wx.getStorageSync("tgg_token") && wx.getStorageSync("tgg_user")?.id) });
    } finally { if (this.visible && version === this.version) this.setData({ loading: false }); }
  },
  authorizePhone(e) {
    if (this.data.loading) return;
    if (!e.detail?.code) {
      const privacyMissing = Number(e.detail?.errno) === 112 || /not declared|privacy agreement/i.test(String(e.detail?.errMsg || ""));
      this.setData({ error: privacyMissing
        ? "手机号授权暂不可用：小程序隐私保护指引中的手机号声明尚未生效，请联系客服"
        : "未获得手机号授权，请重新授权后关联门店会员，你的小程序会员权益不受影响" });
      return;
    }
    return this.load({ phoneCode: e.detail.code });
  },
  goLogin() { wx.navigateTo({ url: "/pages/login/index" }); }
});
