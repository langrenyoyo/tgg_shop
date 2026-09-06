const DEFAULT_BASE_URL = "http://127.0.0.1:5190";

function getBaseUrl() {
  const cfg = wx.getStorageSync("tgg_config") || {};
  return (cfg.tggApiUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getToken() {
  return wx.getStorageSync("tgg_token") || "";
}

function request(path, { method = "GET", data = null } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
      header: {
        "content-type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.error || `请求失败 ${res.statusCode}`));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || "请求失败"));
      }
    });
  });
}

function uploadFile(filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${getBaseUrl()}/api/common/upload`,
      filePath,
      name: "file",
      formData: {},
      header: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      success(res) {
        try {
          const json = JSON.parse(res.data);
          if (json.code !== 0) return reject(new Error(json.msg || "上传失败"));
          resolve(json.data?.[0] || {});
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
  request,
  uploadFile
};
