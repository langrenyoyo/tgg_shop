const { request } = require("./api");

async function login(userId, password) {
  const res = await request("/api/auth/login", {
    method: "POST",
    data: { userId, password }
  });
  wx.setStorageSync("tgg_token", res.token);
  wx.setStorageSync("tgg_user", res.user || null);
  const app = getApp();
  app.globalData.token = res.token;
  app.globalData.user = res.user || null;
  return res;
}

module.exports = {
  login,
  async wechatLogin() {
    const code = await new Promise((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error("微信登录未获取到 code")), fail: reject }));
    const res = await request("/api/auth/wechat-login", { method: "POST", data: { code } });
    wx.setStorageSync("tgg_token", res.token); wx.setStorageSync("tgg_user", res.user || null); getApp().globalData.token = res.token; getApp().globalData.user = res.user || null; return res;
  }
};
