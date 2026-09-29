const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("all registered pages load with a JS-only mini-program module resolver", async () => {
  const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
  const modules = new Map();
  const pages = [];
  const calls = [];
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
    getStorageSync: () => null,
    request: options => { calls.push(options); options.success({ statusCode: 200, data: {} }); }
  };
  function load(file) {
    if (!file.endsWith(".js")) file += ".js";
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    vm.runInNewContext(fs.readFileSync(file, "utf8"), {
      module, exports: module.exports, wx, Page: page => pages.push(page),
      require: name => {
        assert.ok(name.startsWith("."), `Unexpected external module: ${name}`);
        return load(path.resolve(path.dirname(file), name));
      }
    }, { filename: file });
    return module.exports;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  for (const page of manifest.pages) load(path.join(root, page));
  assert.equal(pages.length, manifest.pages.length);
  await load(path.join(root, "utils/api.js")).request("/api/home");
  assert.equal(calls[0].url, "https://shop.taoguoguo.cc/api/home");
});

function setup(version, overrides = {}) {
  const calls = [];
  const environments = { develop: "https://dev.vendor.com", trial: "https://trial.vendor.com", release: "https://prod.vendor.com", ...overrides };
  const developmentConfig = overrides.developmentConfig || { tggApiUrl: "https://cached-test.vendor.com" };
  const context = { module: { exports: {} }, require: () => environments, wx: {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }),
    getDeviceInfo: () => ({ platform: overrides.platform || "ios" }),
    getStorageSync: key => key === "tgg_config" ? developmentConfig : "user-token",
    request: options => { calls.push(options); options.success({ statusCode: 200, data: {} }); },
    uploadFile: options => { calls.push(options); options.success({ statusCode: 200, data: JSON.stringify({ code: 0, data: [{ path: "/uploads/proof.png" }] }) }); }
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/api.js"), "utf8"), context);
  return { api: context.module.exports, calls };
}

test("release and trial requests/uploads ignore cached development hosts", async () => {
  for (const [version, host] of [["release", "prod"], ["trial", "trial"], [undefined, "prod"]]) {
    const { api, calls } = setup(version);
    await api.request("/api/me");
    const file = await api.uploadFile("proof.png");
    assert.equal(calls[0].url, `https://${host}.vendor.com/api/me`);
    assert.equal(calls[1].url, `https://${host}.vendor.com/api/common/upload`);
    assert.equal(file.url, `https://${host}.vendor.com/uploads/proof.png`);
  }
});

test("relative product images resolve against the API origin instead of the developer tool page host", () => {
  const { api } = setup("release");
  assert.equal(api.resolveAssetUrl("/assets/apple.jpg"), "https://prod.vendor.com/assets/apple.jpg");
  assert.equal(api.resolveAssetUrl("assets/grapes.jpg"), "https://prod.vendor.com/assets/grapes.jpg");
  assert.equal(api.resolveAssetUrl("https://cdn.example.com/strawberry.jpg"), "https://cdn.example.com/strawberry.jpg");
});

test("development uses configured HTTPS host instead of cached overrides; unconfigured releases send no token", async () => {
  const dev = setup("develop");
  await dev.api.request("/api/me");
  assert.equal(dev.calls[0].url, "https://dev.vendor.com/api/me");
  for (const release of ["", "http://prod.vendor.com", "https://user:password@prod.vendor.com"]) {
    const { api, calls } = setup("release", { release });
    await assert.rejects(api.request("/api/me"), /服务地址未配置/);
    await assert.rejects(api.uploadFile("proof.png"), /服务地址未配置/);
    assert.equal(calls.length, 0);
  }
});

test("development may target an isolated local HTTP backend while releases remain HTTPS-only", async () => {
  const { api, calls } = setup("develop", { develop: "http://127.0.0.1:5788", developmentConfig: { tggApiUrl: "http://127.0.0.1:5788" } });
  await api.request("/api/health");
  assert.equal(calls[0].url, "http://127.0.0.1:5788/api/health");
  const release = setup("release", { release: "http://127.0.0.1:5788" });
  await assert.rejects(release.api.request("/api/health"), /服务地址未配置/);
});

test("developer tools, physical devices and published builds all use the online backend", async () => {
  const actual = require("../../../../wechat-miniprogram/config/environments");
  for (const [version, platform, expected] of [
    ["develop", "devtools", "https://shop.taoguoguo.cc"],
    ["develop", "ios", "https://shop.taoguoguo.cc"],
    ["develop", "android", "https://shop.taoguoguo.cc"],
    ["trial", "devtools", "https://shop.taoguoguo.cc"],
    ["release", "devtools", "https://shop.taoguoguo.cc"]
  ]) {
    const { api, calls } = setup(version, { ...actual, platform, developmentConfig: {} });
    await api.request("/api/health");
    assert.equal(calls[0].url, expected + "/api/health");
  }
  for (const cachedUrl of ["http://127.0.0.1:5177", "https://explicit.example.com"]) {
    const cached = setup("develop", { ...actual, platform: "devtools", developmentConfig: { tggApiUrl: cachedUrl } });
    await cached.api.request("/api/health");
    assert.equal(cached.calls[0].url, "https://shop.taoguoguo.cc/api/health");
  }
});

test("station password login and customer requests resolve the same online backend", async () => {
  const actual = require("../../../../wechat-miniprogram/config/environments");
  const { api } = setup("develop", { ...actual, platform: "devtools", developmentConfig: {} });
  const calls = [];
  const context = { module: { exports: {} }, require: () => api, wx: {
    getStorageSync: () => "",
    request: options => { calls.push(options); options.success({ statusCode: 200, data: { ok: true } }); }
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/station-api.js"), "utf8"), context);
  await context.module.exports.request("/api/station/auth/login", { method: "POST", data: { username: "test-worker", password: "test-password" }, retry: false });
  assert.equal(calls[0].url, "https://shop.taoguoguo.cc/api/station/auth/login");
  assert.equal(calls[0].data.password, "test-password");
  assert.equal(calls[0].method, "POST");
});
