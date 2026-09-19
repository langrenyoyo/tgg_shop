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
  async wechatLogin({ isCurrent = () => true } = {}) {
    const previousToken = wx.getStorageSync("tgg_token");
    const checkCurrent = () => {
      if (!isCurrent() || wx.getStorageSync("tgg_token") !== previousToken) throw new Error("登录状态已变化，请重新登录");
    };
    const code = await new Promise((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error("微信登录未获取到 code")), fail: reject }));
    checkCurrent();
    const inviteCode = wx.getStorageSync("tgg_pending_invite") || "";
    const res = await request("/api/auth/wechat-login", { method: "POST", data: { code, inviteCode } });
    checkCurrent();
    saveSession(res);
    mergeGuestCart();
    wx.removeStorageSync("tgg_pending_invite");
    return res;
  }
};
