const { getBaseUrl } = require("./api");

let refreshPromise = null;

function stationToken() { return wx.getStorageSync("tgg_station_token") || ""; }
function stationRefreshToken() { return wx.getStorageSync("tgg_station_refresh_token") || ""; }
function saveStationSession(res) {
  wx.setStorageSync("tgg_station_token", res.token || "");
  if (res.refreshToken) wx.setStorageSync("tgg_station_refresh_token", res.refreshToken);
  if (res.station) wx.setStorageSync("tgg_station", res.station);
  Object.assign(getApp().globalData, { stationToken: res.token || "", station: res.station || wx.getStorageSync("tgg_station") || null });
  return res;
}
function clearStationSession() {
  refreshPromise = null;
  ["tgg_station_token", "tgg_station_refresh_token", "tgg_station"].forEach(key => wx.removeStorageSync(key));
  Object.assign(getApp().globalData, { stationToken: "", station: null });
}
function request(path, { method = "GET", data = null, retry = true } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
      header: { "content-type": "application/json", ...(stationToken() ? { Authorization: `Bearer ${stationToken()}` } : {}) },
      success: async (res) => {
        if (res.statusCode === 401 && retry && stationRefreshToken()) {
          try {
            if (!refreshPromise) {
              refreshPromise = request("/api/station/auth/refresh", { method: "POST", data: { refreshToken: stationRefreshToken() }, retry: false })
                .then(saveStationSession).finally(() => { refreshPromise = null; });
            }
            await refreshPromise;
            return request(path, { method, data, retry: false }).then(resolve, reject);
          } catch (error) { return reject(error); }
        }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
        const error = new Error(res.data?.error || `请求失败 ${res.statusCode}`);
        error.statusCode = res.statusCode;
        reject(error);
      },
      fail: error => reject(new Error(error.errMsg || "请求失败"))
    });
  });
}

module.exports = { request, saveStationSession, clearStationSession, stationToken };
