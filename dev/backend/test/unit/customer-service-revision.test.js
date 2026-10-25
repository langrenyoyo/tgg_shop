process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const { activeConfig } = require("../../src/config/active-config");
const admin = require("../../src/services/admin-service");

const miniRoot = path.resolve(__dirname, "../../../../wechat-miniprogram");
const readMini = relativePath => fs.readFileSync(path.join(miniRoot, relativePath), "utf8");
const actor = { role: { id: "super_admin", permissions: ["*"] } };

test("customer service QR configuration is validated and exposed to the mini program", () => {
  const state = createSeed();
  const configured = admin.updateConfig(state, { customerServiceQrCode: "/uploads/customer-service.png", reason: "configure customer service" }, actor);
  assert.equal(configured.customerServiceQrCode, "/uploads/customer-service.png");
  assert.equal(activeConfig(state.config).customerServiceQrCode, "/uploads/customer-service.png");

  const before = state.config.customerServiceQrCode;
  const invalid = admin.updateConfig(state, { customerServiceQrCode: "http://insecure.example/qr.png", reason: "invalid" }, actor);
  assert.equal(invalid.status, 400);
  assert.equal(state.config.customerServiceQrCode, before);
});

test("the October 23 customer-service entry and copy changes remain wired as requested", () => {
  const me = readMini("pages/me/index.wxml");
  const home = readMini("pages/home/index.wxml");
  const homeStyles = readMini("pages/home/index.wxss");
  const addressStyles = readMini("pages/address/index.wxss");
  const invite = readMini("pages/invite/index.wxml");
  const inviteStyles = readMini("pages/invite/index.wxss");

  assert.match(me, /open-type="contact"[^>]*>[\s\S]*?在线客服/);
  assert.match(me, /class="benefit benefit-main" bindtap="goCustomerService"[\s\S]*?企业客服[\s\S]*?获取更高收益[\s\S]*?请添加企业客服/);
  assert.equal((me.match(/class="benefit" bindtap="goMembership"/g) || []).length, 1);
  assert.match(me, /class="benefit" bindtap="goTasks"[\s\S]*?任务权益[\s\S]*?做任务赚积分/);
  assert.match(me, /class="activity-item" bindtap="goCustomerService"[\s\S]*?代理申请/);
  assert.match(me, /class="cooperation-title">供应商合作/);
  assert.doesNotMatch(me, /data-type="recruiting"/);

  assert.doesNotMatch(home, /hero-copy|hero-stamp/);
  assert.match(home, /class="quick-item" bindtap="goTasks"[\s\S]*?<view>赚积分<\/view><text>积分兑好物<\/text>/);
  assert.doesNotMatch(home, /<view>做任务<\/view><text>积分慢慢攒<\/text>/);
  assert.match(home, /class="exchange-strip" bindtap="goCustomerService"[\s\S]*?获取更高收益[\s\S]*?请添加企业客服/);
  assert.match(homeStyles, /\.home-category\s*\{[^}]*font-size:\s*24rpx/);
  assert.match(homeStyles, /\.home-category-icon\s*\{[^}]*width:\s*92rpx[^}]*height:\s*92rpx/);
  assert.match(homeStyles, /\.home-category-icon image\s*\{[^}]*width:\s*74rpx[^}]*height:\s*74rpx/);
  assert.match(addressStyles, /input\s*\{[^}]*height:\s*76rpx[^}]*line-height:\s*76rpx[^}]*padding:\s*0 20rpx/);
  assert.match(invite, /class="invite-actions"/);
  assert.match(inviteStyles, /gap:\s*16rpx/);
});

test("cart quantity controls use fixed view controls for consistent physical-device layout", () => {
  const markup = readMini("pages/cart/index.wxml");
  const styles = readMini("pages/cart/index.wxss");
  assert.equal((markup.match(/class="stepper-button/g) || []).length, 2);
  assert.doesNotMatch(markup, /<view class="stepper"><button/);
  assert.match(markup, /<text class="stepper-count">\{\{item\.quantity\}\}<\/text>/);
  assert.match(styles, /\.stepper\s*\{[^}]*display:\s*flex[^}]*flex:\s*0 0 170rpx[^}]*min-width:\s*170rpx/);
  assert.match(styles, /\.stepper-button[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/);
});

test("both higher-income entries navigate to one QR page and that page supports preview", async () => {
  const navigations = [];
  let homePage;
  vm.runInNewContext(readMini("pages/home/index.js"), {
    Page: page => { homePage = page; },
    require: name => name.endsWith("product-cart") ? {} : { request: async () => ({}) },
    wx: { navigateTo: value => navigations.push(value.url) }
  });
  homePage.goCustomerService();

  let mePage;
  vm.runInNewContext(readMini("pages/me/index.js"), {
    Page: page => { mePage = page; },
    require: () => ({}),
    wx: { navigateTo: value => navigations.push(value.url) }
  });
  mePage.goCustomerService();
  assert.deepEqual(navigations, ["/pages/customer-service/index", "/pages/customer-service/index"]);

  const previews = [];
  let qrPage;
  vm.runInNewContext(readMini("pages/customer-service/index.js"), {
    Page: page => { qrPage = page; },
    require: () => ({ request: async () => ({ customerServiceQrCode: "/uploads/customer.png" }), resolveAssetUrl: value => `https://shop.example${value}` }),
    wx: { previewImage: value => previews.push(value) }
  });
  qrPage.setData = value => Object.assign(qrPage.data, value);
  await qrPage.load();
  assert.equal(qrPage.data.qrCode, "https://shop.example/uploads/customer.png");
  qrPage.preview();
  assert.equal(previews[0].current, qrPage.data.qrCode);
  assert.equal(previews[0].urls.length, 1);
  assert.equal(previews[0].urls[0], qrPage.data.qrCode);
});
