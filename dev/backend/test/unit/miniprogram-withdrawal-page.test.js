const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(balance = 600, options = {}) {
  const requests = [];
  const toasts = [];
  const transfers = [];
  const navigations = [];
  const storage = { tgg_user: { id: "user-1" } };
  let page;
  const now = new Date().toISOString();
  const rows = [
    { id: "wd-pending", amount: 50, status: "pending_review", createdAt: now },
    { id: "wd-rejected", amount: 70, status: "rejected", reason: "请核对收款信息", createdAt: now }
  ];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/service/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => ({ request: async (url, requestOptions) => {
      requests.push({ url, options: requestOptions });
      if (url === "/api/me") return { id: storage.tgg_user?.id, withdrawableBalance: balance };
      if (url === "/api/withdrawals/authorization" && requestOptions?.method === "POST") return options.start ? options.start() : { appId: "wx123", mchId: "1900000001", authorizationPackage: "native-package", status: "pending" };
      if (url === "/api/withdrawals/authorization") return options.authorization ? options.authorization() : { status: "none", required: true };
      if (url === "/api/config") return { withdrawMinAmount: 1, withdrawMaxAmount: 200, withdrawFeeRate: 0.01, withdrawDailyCountLimit: 2, withdrawDailyAmountLimit: 500, deliveryTimeZone: "Asia/Shanghai" };
      if (url === "/api/withdrawals" && !requestOptions) return rows;
      if (url.endsWith("/transfer-package")) return { package: "provider-package", mchId: "1900000001" };
      return { ok: true };
    } }),
    wx: {
      getStorageSync: key => storage[key],
      navigateToMiniProgram: value => { navigations.push(value); if (options.navigationError) value.fail({ errMsg: options.navigationError }); else value.success({}); },
      showToast: value => toasts.push(value), getAccountInfoSync: () => ({ miniProgram: { appId: "wx123" } }), requestMerchantTransfer: value => { transfers.push(value); if (options.navigationError) value.fail({ errMsg: options.navigationError }); else value.success({}); }
    }
  });
  page.setData = value => Object.assign(page.data, value);
  page.type = "withdraw";
  page.setData({ type: "withdraw" });
  return { page, requests, toasts, transfers, navigations, storage };
}

test("authorization requests a server package and opens native WeChat without trusting UI success", async () => {
  const { page, requests, navigations, transfers } = setup();
  await page.load();
  await page.authorizeWechat();
  assert.equal(navigations.length, 0);
  assert.equal(transfers[0].appId, "wx123");
  assert.equal(transfers[0].mchId, "1900000001");
  assert.equal(transfers[0].package, "native-package");
  assert.equal(requests.filter(x => x.url === "/api/withdrawals/authorization" && x.options?.method === "POST").length, 1);
  assert.equal(page.data.authorizationStatus, "none");
  page.input({ detail: { value: "1" } });
  await page.submit();
  assert.equal(requests.some(x => x.url === "/api/withdrawals" && x.options?.method === "POST"), false);
});

test("returning refreshes verified authorization; cancelled native authorization permits retry", async () => {
  let status = "none";
  const { page, toasts } = setup(600, { navigationError: "requestMerchantTransfer:fail cancel", authorization: () => ({ status }) });
  await page.load();
  await page.authorizeWechat();
  assert.match(toasts.at(-1).title, /取消/);
  assert.equal(page.data.submitting, false);
  page.onHide();
  status = "active";
  await page.onShow();
  assert.equal(page.data.authorizationStatus, "active");
});

test("authorization lookup failure clears previous success and blocks withdrawal", async () => {
  const { page, requests } = setup(600, { authorization: () => { throw new Error("授权状态查询失败"); } });
  page.data.authorizationStatus = "active";
  await page.load();
  assert.equal(page.data.authorizationStatus, "unknown");
  assert.equal(page.data.error, "授权状态查询失败");
  assert.equal(page.data.balance, 600);
  assert.equal(page.data.withdrawRules.minAmount, 1);
  page.data.amount = "1";
  await page.submit();
  assert.equal(requests.some(x => x.options?.method === "POST"), false);
});

test("4.13 opens provider mini-program and verifies consent on return instead of trusting navigation", async () => {
  let status = "none";
  const f = setup(600, { start: () => ({ method: "miniProgram", status: "none", appId: "wxabcdef1234567890", path: "pages/oauth/index?data=a%2Bb%3D" }),
    authorization: () => ({ status, method: "miniProgram", required: true }) });
  await f.page.load();
  await f.page.authorizeWechat();
  assert.equal(f.transfers.length, 0);
  assert.equal(f.navigations.length, 1);
  assert.equal(f.navigations[0].appId, "wxabcdef1234567890");
  assert.equal(f.navigations[0].path, "pages/oauth/index?data=a%2Bb%3D");
  assert.equal(f.navigations[0].envVersion, "release");
  assert.equal(f.page.data.authorizationStatus, "none");
  f.page.onHide();
  await f.page.onShow({ referrerInfo: { extraData: { is_auth: 1 } } });
  assert.equal(f.page.data.authorizationStatus, "none");
  status = "active";
  f.page.onHide(); await f.page.onShow();
  assert.equal(f.page.data.authorizationStatus, "active");
});

test("4.13 cancellation, invalid target and changed owner never activate consent", async () => {
  const f = setup(600, { navigationError: "navigateToMiniProgram:fail cancel", start: () => ({ method: "miniProgram", appId: "wxabcdef1234567890", path: "pages/oauth/index?data=x" }) });
  await f.page.load(); await f.page.authorizeWechat();
  assert.match(f.toasts.at(-1).title, /取消/);
  assert.equal(f.page.data.submitting, false);
  assert.notEqual(f.page.data.authorizationStatus, "active");
  const invalid = setup(600, { start: () => ({ method: "miniProgram", appId: "bad", path: "https://example.test" }) });
  await invalid.page.load(); await invalid.page.authorizeWechat();
  assert.equal(invalid.navigations.length, 0);
  let release;
  const changed = setup(600, { start: () => new Promise(resolve => { release = resolve; }) });
  await changed.page.load();
  const pending = changed.page.authorizeWechat();
  changed.storage.tgg_user = { id: "another" };
  release({ method: "miniProgram", appId: "wxabcdef1234567890", path: "pages/oauth/index?data=x" });
  await pending;
  assert.equal(changed.navigations.length, 0);
});

test("late authorization status cannot restore another account's state or an unloaded page", async () => {
  let resolve;
  const { page, storage } = setup(600, { authorization: () => new Promise(r => { resolve = r; }) });
  const pending = page.load();
  storage.tgg_user = { id: "user-2" };
  resolve({ status: "active" });
  await pending;
  assert.notEqual(page.data.authorizationStatus, "active");
  const next = page.load();
  page.onUnload();
  resolve({ status: "active" });
  await next;
  assert.notEqual(page.data.authorizationStatus, "active");
});

test("withdraw page presents configured limits and excludes rejected requests from today's usage", async () => {
  const { page, requests } = setup();
  await page.load();
  assert.equal(page.data.withdrawRules.minAmount, 1);
  assert.equal(page.data.withdrawRules.feePercent, 1);
  assert.equal(page.data.withdrawRules.dailyCount, "2 次/日");
  assert.equal(page.data.withdrawRules.dailyAmount, "¥500/日");
  assert.equal(page.data.withdrawRules.todayCount, 1);
  assert.equal(page.data.withdrawRules.todayAmount, "50.00");
  assert.equal(page.data.rows[0].statusText, "审核中");
  assert.equal(page.data.rows[1].reason, "请核对收款信息");

  page.input({ detail: { value: "451" } });
  assert.equal(page.data.withdrawAmountError, "单笔提现金额不能超过 ¥200");
  await page.submit();
  assert.equal(requests.some(item => item.url === "/api/withdrawals" && item.options?.method === "POST"), false);
});

test("withdraw page explains a below-minimum balance and does not submit", async () => {
  const { page, requests, toasts } = setup(0.5);
  await page.load();

  assert.equal(page.data.balanceBelowMinimum, true);
  await page.submit();

  assert.equal(toasts.at(-1).title, "可提现余额未达到最低提现金额");
  assert.equal(requests.some(item => item.url === "/api/withdrawals" && item.options?.method === "POST"), false);
});

test("withdraw page requests the owner's provider package and invokes WeChat merchant transfer confirmation", async () => {
  const { page, requests, transfers } = setup();
  await page.confirmTransfer({ currentTarget: { dataset: { id: "wd-processing" } } });

  assert.equal(requests.some(item => item.url === "/api/withdrawals/wd-processing/transfer-package"), true);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].mchId, "1900000001");
  assert.equal(transfers[0].appId, "wx123");
  assert.equal(transfers[0].package, "provider-package");
});

test("native authorization never opens a package for another app or a changed account", async () => {
  const wrong = setup(600, { start: () => ({ appId: "wx-other", mchId: "1900000001", authorizationPackage: "wrong" }) });
  await wrong.page.load();
  await wrong.page.authorizeWechat();
  assert.equal(wrong.transfers.length, 0);
  assert.match(wrong.toasts.at(-1).title, /不匹配/);
  let release;
  const changed = setup(600, { start: () => new Promise(resolve => { release = resolve; }) });
  await changed.page.load();
  const pending = changed.page.authorizeWechat();
  changed.storage.tgg_user = { id: "user-2" };
  release({ appId: "wx123", mchId: "1900000001", authorizationPackage: "old-owner" });
  await pending;
  assert.equal(changed.transfers.length, 0);
});
