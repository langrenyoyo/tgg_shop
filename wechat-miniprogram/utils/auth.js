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
  login
};
