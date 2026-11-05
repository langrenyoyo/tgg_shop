const environments = require("../config/environments");

function getBaseUrl() {
  const version = wx.getAccountInfoSync?.().miniProgram?.envVersion;
  let inDevtools = false;
  if (version === "develop") {
    try {
      const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync?.();
      inDevtools = device?.platform === "devtools";
    } catch { /* If platform detection is unavailable, use the configured HTTPS environment. */ }
  }
  const defaultUrl = inDevtools ? environments.devtools || environments.develop : environments[version || "release"];
  // Use the checked-in environment; stale local cache must not redirect login.
  const baseUrl = defaultUrl;
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
  ["tgg_token", "tgg_token_expires_at", "tgg_refresh_token", "tgg_user"].forEach(key => wx.removeStorageSync(key));
  Object.assign(getApp().globalData, { token: "", user: null });
}

function saveSession(res, { refreshed = false } = {}) {
  if (!refreshed) {
    sessionVersion += 1;
    refreshPromise = null;
  }
  wx.setStorageSync("tgg_token", res.token);
  if (res.expiresAt) wx.setStorageSync("tgg_token_expires_at", res.expiresAt);
  else wx.removeStorageSync("tgg_token_expires_at");
  if (res.refreshToken) wx.setStorageSync("tgg_refresh_token", res.refreshToken);
  else if (!refreshed) wx.removeStorageSync("tgg_refresh_token");
  if (res.user) wx.setStorageSync("tgg_user", res.user);
  else if (!refreshed) wx.removeStorageSync("tgg_user");
  Object.assign(getApp().globalData, { token: res.token, user: res.user || wx.getStorageSync("tgg_user") || null });
}

function tokenExpiresSoon(token) {
  let expiresAt = Date.parse(wx.getStorageSync("tgg_token_expires_at") || "");
  // Older installations only cached the token. Decode its expiry as a refresh
  // hint; the server still verifies the signature and session on every request.
  if (!Number.isFinite(expiresAt) && token && wx.base64ToArrayBuffer) {
    try {
      let encoded = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      encoded += "=".repeat((4 - encoded.length % 4) % 4);
      const bytes = new Uint8Array(wx.base64ToArrayBuffer(encoded));
      const json = decodeURIComponent(Array.from(bytes, byte => "%" + byte.toString(16).padStart(2, "0")).join(""));
      const exp = JSON.parse(json).exp;
      if (typeof exp === "number" && Number.isFinite(exp)) expiresAt = exp * 1000;
    } catch { /* Unknown token formats are checked by the server. */ }
  }
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30000;
}

function refreshSession(version, token) {
  if (version !== sessionVersion) return Promise.reject(sessionChanged());
  // A late failure from an older token can reuse the refreshed session.
  if (token !== getToken()) return Promise.resolve();
  if (!refreshPromise) {
    const refreshToken = wx.getStorageSync("tgg_refresh_token");
    if (!refreshToken) {
      clearSession();
      return Promise.reject(loginRequired());
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
  return refreshPromise;
}

function request(path, { method = "GET", data = null, retry = true, authRequired = false } = {}) {
  const version = sessionVersion;
  const token = getToken();
  const authPath = path.startsWith("/api/auth/");
  if (!authPath && authRequired && !token && !wx.getStorageSync("tgg_refresh_token")) return Promise.reject(loginRequired());
  if (!authPath && authRequired && retry && (refreshPromise || !token || tokenExpiresSoon(token))) {
    return refreshSession(version, token).then(() => {
      if (version !== sessionVersion) throw sessionChanged();
      return request(path, { method, data, retry: false, authRequired });
    });
  }
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
            await refreshSession(version, token);
            if (version !== sessionVersion) throw sessionChanged();
          } catch (error) {
            reject(error);
            return;
          }
          request(path, { method, data, retry: false, authRequired }).then(resolve, reject);
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
  getBaseUrl,
  saveSession,
  clearSession,
  request,
  uploadFile,
  resolveAssetUrl
};
