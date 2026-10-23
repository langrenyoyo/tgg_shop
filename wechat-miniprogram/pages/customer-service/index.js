const { request, resolveAssetUrl } = require("../../utils/api");

Page({
  data: { qrCode: "", loading: true, error: "" },
  onLoad() { this.load(); },
  onUnload() { this.disposed = true; },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const config = await request("/api/config");
      if (this.disposed) return;
      const qrCode = resolveAssetUrl(config.customerServiceQrCode || "");
      this.setData({ qrCode, error: qrCode ? "" : "客服微信二维码暂未配置，请使用在线客服联系我们" });
    } catch (error) {
      if (!this.disposed) this.setData({ qrCode: "", error: error.message });
    } finally {
      if (!this.disposed) this.setData({ loading: false });
    }
  },
  preview() {
    if (!this.data.qrCode) return;
    wx.previewImage({ current: this.data.qrCode, urls: [this.data.qrCode] });
  }
});
