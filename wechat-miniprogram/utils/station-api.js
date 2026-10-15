const { getBaseUrl } = require("./api");

let refreshPromise = null;
let sessionVersion = 0;

function sessionChanged() { return new Error("登录账号已变更，请刷新页面后重试"); }
function loginRequired() {
  const error = new Error("登录已失效，请重新登录");
  error.statusCode = 401;
  error.code = "AUTH_REQUIRED";
  return error;
}

function stationToken() { return wx.getStorageSync("tgg_station_token") || ""; }
function stationRefreshToken() { return wx.getStorageSync("tgg_station_refresh_token") || ""; }
function saveStationSession(res, { refreshed = false } = {}) {
  if (!refreshed) {
    sessionVersion += 1;
    refreshPromise = null;
  }
  wx.setStorageSync("tgg_station_token", res.token || "");
  if (res.refreshToken) wx.setStorageSync("tgg_station_refresh_token", res.refreshToken);
  else if (!refreshed) wx.removeStorageSync("tgg_station_refresh_token");
  if (res.station) wx.setStorageSync("tgg_station", res.station);
  else if (!refreshed) wx.removeStorageSync("tgg_station");
  Object.assign(getApp().globalData, { stationToken: res.token || "", station: res.station || wx.getStorageSync("tgg_station") || null });
  return res;
}
function clearStationSession() {
  sessionVersion += 1;
  refreshPromise = null;
  ["tgg_station_token", "tgg_station_refresh_token", "tgg_station"].forEach(key => wx.removeStorageSync(key));
  Object.assign(getApp().globalData, { stationToken: "", station: null });
}
function request(path, { method = "GET", data = null, retry = true } = {}) {
  const version = sessionVersion;
  const token = stationToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
      header: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      success: async (res) => {
        if (version !== sessionVersion) return reject(sessionChanged());
        if (res.statusCode === 401 && retry && !path.startsWith("/api/station/auth/")) {
          try {
            if (!refreshPromise && token === stationToken()) {
              const refreshToken = stationRefreshToken();
              if (!refreshToken) {
                clearStationSession();
                throw loginRequired();
              }
              const pending = request("/api/station/auth/refresh", { method: "POST", data: { refreshToken }, retry: false })
                .then(result => {
                  if (version !== sessionVersion) throw sessionChanged();
                  saveStationSession(result, { refreshed: true });
                })
                .catch(error => {
                  if (version === sessionVersion && error.statusCode === 401) {
                    clearStationSession();
                    throw loginRequired();
                  }
                  throw error;
                })
                .finally(() => { if (refreshPromise === pending) refreshPromise = null; });
              refreshPromise = pending;
            }
            await refreshPromise;
            if (version !== sessionVersion) throw sessionChanged();
            return request(path, { method, data, retry: false }).then(resolve, reject);
          } catch (error) { return reject(error); }
        }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
        if (res.statusCode === 401 && !path.startsWith("/api/station/auth/")) {
          if (token !== stationToken()) return reject(sessionChanged());
          clearStationSession();
          return reject(loginRequired());
        }
        const error = new Error(res.data?.error || `请求失败 ${res.statusCode}`);
        error.statusCode = res.statusCode;
        reject(error);
      },
      fail: error => reject(new Error(error.errMsg || "请求失败"))
    });
  });
}

module.exports = { request, saveStationSession, clearStationSession, stationToken };
