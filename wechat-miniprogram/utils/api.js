const environments = require("../config/environments");

function getBaseUrl() {
  const version = wx.getAccountInfoSync?.().miniProgram?.envVersion;
  const cfg = version === "develop" ? wx.getStorageSync("tgg_config") || {} : {};
  const baseUrl = cfg.tggApiUrl || environments[version || "release"];
  const localDevelopmentUrl = version === "develop" && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(String(baseUrl || ""));
  if (typeof baseUrl !== "string" || (!/^https:\/\/[^/?#\s@]+\/?$/.test(baseUrl) && !localDevelopmentUrl)) {
    throw new Error("服务地址未配置，请联系管理员");
  }
  return baseUrl.replace(/\/$/, "");
}

function resolveAssetUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const source = value.trim();
  if (/^https?:\/\//i.test(source)) return source;
  if (/^\/\//.test(source)) return `https:${source}`;
  if (source.startsWith("/")) return `${getBaseUrl()}${source}`;
  return `${getBaseUrl()}/${source.replace(/^\/+/, "")}`;
}

function getToken() {
  return wx.getStorageSync("tgg_token") || "";
}

let refreshPromise = null;
let sessionVersion = 0;
function sessionChanged() { return new Error("登录账号已变更，请刷新页面后重试"); }
function loginRequired() {
  const error = new Error("登录已失效，请重新登录");
  error.statusCode = 401;
  error.code = "AUTH_REQUIRED";
  return error;
}
function clearSession() {
  sessionVersion += 1;
  refreshPromise = null;
  ["tgg_token", "tgg_refresh_token", "tgg_user"].forEach(key => wx.removeStorageSync(key));
  Object.assign(getApp().globalData, { token: "", user: null });
}

function saveSession(res, { refreshed = false } = {}) {
  if (!refreshed) {
    sessionVersion += 1;
    refreshPromise = null;
  }
  wx.setStorageSync("tgg_token", res.token);
  if (res.refreshToken) wx.setStorageSync("tgg_refresh_token", res.refreshToken);
  else if (!refreshed) wx.removeStorageSync("tgg_refresh_token");
  if (res.user) wx.setStorageSync("tgg_user", res.user);
  else if (!refreshed) wx.removeStorageSync("tgg_user");
  Object.assign(getApp().globalData, { token: res.token, user: res.user || wx.getStorageSync("tgg_user") || null });
}

function request(path, { method = "GET", data = null, retry = true } = {}) {
  const version = sessionVersion;
  const token = getToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
      header: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      async success(res) {
        if (version !== sessionVersion) return reject(sessionChanged());
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401 && retry && !path.startsWith("/api/auth/")) {
          try {
            // A late 401 from an old access token can reuse the refreshed token.
            if (!refreshPromise && token === getToken()) {
              const refreshToken = wx.getStorageSync("tgg_refresh_token");
              if (!refreshToken) {
                clearSession();
                throw loginRequired();
              }
              const pending = request("/api/auth/refresh", { method: "POST", data: { refreshToken }, retry: false })
                .then(result => {
                  if (version !== sessionVersion) throw sessionChanged();
                  saveSession(result, { refreshed: true });
                }).catch(error => {
                  if (version === sessionVersion && error.statusCode === 401) {
                    clearSession();
                    throw loginRequired();
                  }
                  throw error;
                }).finally(() => { if (refreshPromise === pending) refreshPromise = null; });
              refreshPromise = pending;
            }
            await refreshPromise;
            if (version !== sessionVersion) throw sessionChanged();
          } catch (error) {
            reject(error);
            return;
          }
          request(path, { method, data, retry: false }).then(resolve, reject);
        } else if (res.statusCode === 401 && !path.startsWith("/api/auth/")) {
          // A rejected retry must not leave an unusable token in storage, or the
          // login page would treat it as an authenticated profile-edit session.
          if (token !== getToken()) return reject(sessionChanged());
          clearSession();
          reject(loginRequired());
        } else {
          const error = new Error(res.data?.error || `请求失败 ${res.statusCode}`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || "请求失败"));
      }
    });
  });
}

function uploadFile(filePath) {
  const version = sessionVersion;
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${getBaseUrl()}/api/common/upload`,
      filePath,
      name: "file",
      formData: {},
      header: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      success(res) {
        if (version !== sessionVersion) return reject(sessionChanged());
        try {
          const json = JSON.parse(res.data);
          if (res.statusCode < 200 || res.statusCode >= 300 || json.code !== 0) {
            const error = new Error(json.error || json.msg || "上传失败");
            error.statusCode = res.statusCode;
            return reject(error);
          }
          const file = json.data?.[0] || {};
          const rawUrl = file.path || file.url;
          const absoluteUrl = typeof rawUrl === "string" && /^\/(?!\/)/.test(rawUrl) ? getBaseUrl() + rawUrl : rawUrl;
          if (typeof absoluteUrl !== "string" || !/^https?:\/\//i.test(absoluteUrl)) return reject(new Error("上传未返回有效图片地址"));
          resolve({ ...file, path: absoluteUrl, url: absoluteUrl });
        } catch (err) {
          reject(err);
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || "上传失败"));
      }
    });
  });
}

module.exports = {
  saveSession,
  clearSession,
  request,
  uploadFile,
  resolveAssetUrl
};
