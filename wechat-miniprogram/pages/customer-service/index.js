const { request, resolveAssetUrl } = require("../../utils/api");

Page({
  data: { qrCode: "", loading: true, saving: false, error: "" },
  onLoad() { this.load(); },
  onUnload() { this.disposed = true; },
  async load() {
    if (this.disposed) return;
    const version = this.version = (this.version || 0) + 1;
    this.setData({ qrCode: "", loading: true, error: "" });
    try {
      const config = await request("/api/config");
      if (this.disposed || version !== this.version) return;
      const qrCode = resolveAssetUrl(config.customerServiceQrCode || "");
      this.setData({ qrCode, error: qrCode ? "" : "企业微信二维码暂未配置，请联系商家配置" });
    } catch (error) {
      if (!this.disposed && version === this.version) this.setData({ qrCode: "", error: error.message });
    } finally {
      if (!this.disposed && version === this.version) this.setData({ loading: false });
    }
  },
  imageError(e) {
    if (this.disposed || (e?.currentTarget?.dataset?.src && e.currentTarget.dataset.src !== this.data.qrCode)) return;
    this.setData({ qrCode: "", error: "二维码图片加载失败，请重新加载" });
  },
  async saveQr() {
    if (this.disposed || this.data.loading || this.data.saving || !this.data.qrCode) return;
    const source = this.data.qrCode;
    this.setData({ saving: true });
    try {
      // Download the original file. Screenshots and recompressed thumbnails can make a QR unreadable.
      const file = await new Promise((resolve, reject) => wx.downloadFile({ url: source, success: resolve, fail: reject }));
      if (this.disposed || source !== this.data.qrCode) return;
      if (file.statusCode !== 200 || !file.tempFilePath) throw new Error("二维码下载失败，请稍后重试");
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: file.tempFilePath, success: resolve, fail: reject }));
      if (!this.disposed) wx.showToast({ title: "已保存，请用微信扫一扫识别", icon: "none" });
    } catch (error) {
      if (this.disposed) return;
      if (/auth deny|auth denied|authorize|permission/i.test(error.errMsg || "")) {
        wx.showModal({ title: "需要相册权限", content: "请允许保存图片，再使用微信扫一扫从相册识别二维码。", confirmText: "去设置", success: result => { if (result.confirm && !this.disposed) wx.openSetting({}); } });
      } else if (!/cancel/i.test(error.errMsg || "")) wx.showToast({ title: error.message || "保存失败，请检查网络后重试", icon: "none" });
    } finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  preview() {
    if (this.disposed || this.data.loading || !this.data.qrCode) return;
    wx.previewImage({
      current: this.data.qrCode,
      urls: [this.data.qrCode],
      showmenu: true,
      fail: () => {
        if (!this.disposed) wx.showToast({ title: "二维码打开失败，请稍后重试", icon: "none" });
      }
    });
  }
});
