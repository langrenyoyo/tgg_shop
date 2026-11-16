const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  let page, logins = 0, navigations = 0;
  const storage = new Map(), pending = [], uploads = [], privacy = [];
  const app = { globalData: {} };
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    requirePrivacyAuthorize: options => privacy.push(options), showToast() {},
    navigateBack: () => navigations++, reLaunch: () => navigations++
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/login/index.js"), "utf8"), {
    Page: value => { page = value; }, wx, getApp: () => app, getCurrentPages: () => [{}],
    require: () => ({
      wechatLogin: async () => {
        logins++;
        const user = { id: "alice", nickname: "微信用户" };
        storage.set("tgg_user", user); storage.set("tgg_token", "token");
        return { user };
      },
      request: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })),
      uploadFile: file => new Promise((resolve, reject) => uploads.push({ file, resolve, reject })),
      resolveAssetUrl: value => value ? "https://shop.taoguoguo.cc" + value : ""
    })
  });
  page.setData = value => Object.assign(page.data, value);
  page.onLoad();
  return { page, wx, privacy, storage, uploads, pending, app, logins: () => logins, navigations: () => navigations };
}
function edit(h) {
  const user = { id: "alice", nickname: "Alice" };
  h.storage.set("tgg_user", user); h.storage.set("tgg_token", "token");
  h.page.openProfile(user);
  h.page.onChooseAvatar({ detail: { avatarUrl: "wxfile://selected.png" } });
}

test("login requires explicit consent, denial makes no login request, and retry opens profile", async () => {
  const h = setup();
  await h.page.handleLogin();
  assert.equal(h.privacy.length, 0); assert.equal(h.logins(), 0);
  h.page.onConsentChange({ detail: { value: ["agree"] } });
  const denied = h.page.handleLogin({ detail: { code: "phone-code" } });
  await h.page.handleLogin();
  assert.equal(h.privacy.length, 1);
  h.privacy[0].fail(); await denied;
  assert.equal(h.logins(), 0); assert.equal(h.page.data.loading, false);
  const accepted = h.page.handleLogin({ detail: { code: "phone-code" } }); h.privacy[1].success(); await accepted;
  assert.equal(h.logins(), 1); assert.equal(h.page.data.stage, "profile");
  assert.equal(h.navigations(), 0);
  h.page.skipProfile(); assert.equal(h.navigations(), 1);
});

test("profile uses final form nickname, persists uploaded path and retries save without reupload", async () => {
  const h = setup(); edit(h);
  const save = h.page.saveProfile({ detail: { value: { nickname: "Final name" } } });
  await h.page.saveProfile(); assert.equal(h.uploads.length, 1);
  h.uploads[0].resolve({ path: "https://shop.taoguoguo.cc/uploads/avatar.png" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.pending[0].url, "/api/me");
  assert.equal(h.pending[0].options.data.nickname, "Final name");
  assert.equal(h.pending[0].options.data.avatarUrl, "/uploads/avatar.png");
  h.pending[0].reject(new Error("offline")); await save;
  assert.equal(h.page.data.error, "offline"); assert.equal(h.navigations(), 0);
  const retry = h.page.saveProfile();
  assert.equal(h.uploads.length, 1);
  h.pending[1].resolve({ id: "alice", nickname: "Final name", avatarUrl: "/uploads/avatar.png" }); await retry;
  assert.equal(h.storage.get("tgg_user").nickname, "Final name");
  assert.equal(h.app.globalData.user.nickname, "Final name"); assert.equal(h.navigations(), 1);
});

test("profile upload failure can retry and an account switch cannot update another profile", async () => {
  const h = setup(); edit(h);
  const save = h.page.saveProfile(); h.uploads[0].reject(new Error("upload failed")); await save;
  assert.equal(h.page.data.error, "upload failed"); assert.equal(h.pending.length, 0);
  const retry = h.page.saveProfile();
  h.storage.set("tgg_user", { id: "bob" });
  h.uploads[1].resolve({ path: "https://shop.taoguoguo.cc/uploads/avatar.png" }); await retry;
  assert.equal(h.pending.length, 0); assert.equal(h.navigations(), 0);
  assert.equal(h.storage.get("tgg_user").id, "bob");
});

test("profile identifies upload and save server failures while preserving retry input", async () => {
  const h = setup(); edit(h);
  const upload = h.page.saveProfile();
  h.uploads[0].reject(Object.assign(new Error("服务器暂时无法处理请求"), { statusCode: 500 }));
  await upload;
  assert.match(h.page.data.error, /头像上传失败（500）/);
  assert.equal(h.page.avatarTemp, "wxfile://selected.png");
  assert.equal(h.pending.length, 0);
  assert.equal(h.page.data.loading, false);
  const save = h.page.saveProfile();
  h.uploads[1].resolve({ path: "https://shop.taoguoguo.cc/uploads/avatar.png" });
  await new Promise(resolve => setImmediate(resolve));
  h.pending[0].reject(Object.assign(new Error("服务器暂时无法处理请求"), { statusCode: 500 }));
  await save;
  assert.match(h.page.data.error, /资料保存失败（500）/);
  assert.equal(h.page.avatarPath, "/uploads/avatar.png");
  assert.equal(h.page.data.nickname, "Alice");
  assert.equal(h.storage.get("tgg_user").avatarUrl, undefined);
  assert.equal(h.navigations(), 0);
});

test("unloaded login cannot continue after privacy consent and stale profile cannot overwrite storage", async () => {
  const login = setup(); login.page.setData({ agreed: true });
  const attempt = login.page.handleLogin({ detail: { code: "phone-code" } }); login.page.onUnload(); login.privacy[0].success(); await attempt;
  assert.equal(login.logins(), 0);
  for (const unload of [false, true]) {
    const h = setup(); edit(h); h.page.avatarTemp = ""; h.page.avatarPath = "/uploads/avatar.png";
    const save = h.page.saveProfile();
    if (unload) h.page.onUnload(); else h.storage.set("tgg_user", { id: "bob" });
    h.pending[0].resolve({ id: "alice", nickname: "Changed" }); await save;
    assert.equal(h.storage.get("tgg_user").nickname, unload ? "Alice" : undefined);
    assert.equal(h.navigations(), 0);
  }
});

test("late WeChat authentication cannot restore an abandoned or replaced session", async () => {
  for (const abandon of [false, true]) {
    const storage = new Map();
    let current = true, finishRequest, saves = 0, merges = 0;
    const context = { module: { exports: {} }, wx: {
      login: options => options.success({ code: "test-code" }),
      getStorageSync: key => storage.get(key), removeStorageSync: key => storage.delete(key)
    }, require: () => ({
      request: () => new Promise(resolve => { finishRequest = resolve; }),
      saveSession: () => saves++, mergeGuestCart: () => merges++
    }) };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/auth.js"), "utf8"), context);
    const login = context.module.exports.wechatLogin({ isCurrent: () => current });
    await new Promise(resolve => setImmediate(resolve));
    if (abandon) current = false; else storage.set("tgg_token", "another-account");
    finishRequest({ token: "old-token", user: { id: "alice" } });
    await assert.rejects(login, /登录状态已变化/);
    assert.equal(saves, 0); assert.equal(merges, 0);
  }
});

test("denied phone authorization cannot create a login session", async () => {
  const h = setup(); h.page.setData({ agreed: true });
  await h.page.handleLogin({ detail: { errMsg: "getPhoneNumber:fail user deny" } });
  assert.equal(h.logins(), 0); assert.equal(h.privacy.length, 0);
  assert.match(h.page.data.error, /手机号授权/);
});

test("avatar tap opens album, preserves selection on cancellation and ignores switched accounts", async () => {
  for (const mode of ["success", "cancel", "switch", "denied"]) {
    const h = setup(); edit(h);
    let chooser;
    h.wx.chooseMedia = options => { chooser = options; };
    const choosing = h.page.chooseAvatarFromAlbum();
    h.privacy[0].success();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(chooser.count, 1); assert.equal(chooser.mediaType[0], "image");
    if (mode === "switch") h.storage.set("tgg_user", { id: "bob" });
    if (mode === "cancel" || mode === "denied") chooser.fail({ errMsg: mode === "cancel" ? "chooseMedia:fail cancel" : "chooseMedia:fail auth deny" });
    else chooser.success({ tempFiles: [{ tempFilePath: "wxfile://album.jpg" }] });
    await choosing;
    assert.equal(h.page.data.avatarPreview, mode === "success" ? "wxfile://album.jpg" : "wxfile://selected.png");
    assert.equal(h.page.data.selectingAvatar, false);
    if (mode === "denied") assert.match(h.page.data.error, /相册权限/);
  }
});

test("legacy logged-in user binds a phone without recreating the account", async () => {
  const h = setup(); h.storage.set("tgg_user", { id: "alice" }); h.storage.set("tgg_token", "token");
  h.page.onLoad(); assert.equal(h.page.data.stage, "phone");
  const binding = h.page.bindPhone({ detail: { code: "phone-code" } });
  assert.equal(h.pending[0].url, "/api/me/phone");
  h.pending[0].resolve({ id: "alice", phone: "13912345678", nickname: "微信用户" });
  await binding;
  assert.equal(h.storage.get("tgg_user").phone, "13912345678");
  assert.equal(h.page.data.stage, "profile");
});
