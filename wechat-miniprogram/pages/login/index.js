const { wechatLogin } = require("../../utils/auth");

Page({
  data: {
    loading: false
  },

  async handleLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      await wechatLogin();
      wx.reLaunch({ url: "/pages/home/index" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
