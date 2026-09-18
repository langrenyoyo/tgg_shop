const { request, saveSession } = require("./api");
const { mergeGuestCart } = require("./cart");

async function login(userId, password) {
  const res = await request("/api/auth/login", {
    method: "POST",
    data: { userId, password }
  });
  saveSession(res);
  mergeGuestCart();
  return res;
}

module.exports = {
  login,
  async wechatLogin() {
    const code = await new Promise((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error("微信登录未获取到 code")), fail: reject }));
    const inviteCode = wx.getStorageSync("tgg_pending_invite") || "";
    const res = await request("/api/auth/wechat-login", { method: "POST", data: { code, inviteCode } });
    saveSession(res);
    mergeGuestCart();
    wx.removeStorageSync("tgg_pending_invite");
    return res;
  }
};
