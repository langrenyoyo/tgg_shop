const { login } = require("../../utils/auth");

Page({
  data: {
    userId: "u_1001",
    password: "123456",
    loading: false
  },

  onUserIdInput(e) {
    this.setData({ userId: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  async handleLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      await login(this.data.userId, this.data.password);
      wx.reLaunch({ url: "/pages/home/index" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
