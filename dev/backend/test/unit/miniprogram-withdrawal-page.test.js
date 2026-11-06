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
  const clipboard = [], modals = [];
  const storage = { tgg_user: { id: "user-1" } };
  let page;
  const now = new Date().toISOString();
  const rows = [
    { id: "wd-pending", amount: 50, status: "pending_review", createdAt: now },
    { id: "wd-rejected", amount: 70, status: "rejected", reason: "请核对收款信息", createdAt: now }
  ];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/service/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => ({ getBaseUrl: () => "https://shop.example.test", request: async (url, requestOptions) => {
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
      setClipboardData: value => { if (options.clipboardError) value.fail({ errMsg: "setClipboardData:fail" }); else { clipboard.push(value.data); value.success({}); } },
      showModal: value => modals.push(value),
      getStorageSync: key => storage[key],
      navigateToMiniProgram: value => { navigations.push(value); if (options.navigationError) value.fail({ errMsg: options.navigationError }); else value.success({}); },
      showToast: value => toasts.push(value), getAccountInfoSync: () => ({ miniProgram: { appId: "wx123" } }), requestMerchantTransfer: value => { transfers.push(value); if (options.navigationError) value.fail({ errMsg: options.navigationError }); else value.success({}); }
    }
  });
  page.setData = value => Object.assign(page.data, value);
  page.type = "withdraw";
  page.setData({ type: "withdraw" });
  return { page, requests, toasts, transfers, navigations, storage, clipboard, modals };
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
  assert.equal(page.data.withdrawRules.minAmount, undefined);
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

test("4.14 copies an HTTPS browser link with a private fragment and verifies on return", async () => {
  let status = "none";
  const scheme = "weixin://dl/business/?t=secret%2Bticket%3D";
  const f = setup(600, { start: () => ({ method: "urlScheme", status: "none", scheme, expireTime: -1 }),
    authorization: () => ({ status, method: "urlScheme", required: true }) });
  await f.page.load(); await f.page.authorizeWechat();
  assert.equal(f.transfers.length + f.navigations.length, 0);
  assert.equal(f.clipboard.length, 1);
  const link = new URL(f.clipboard[0]);
  assert.equal(link.origin, "https://shop.example.test");
  assert.equal(link.pathname, "/user/withdrawal-authorization.html");
  assert.equal(link.search, "");
  assert.deepEqual(JSON.parse(decodeURIComponent(link.hash.slice(1))), { scheme, expireTime: -1 });
  assert.match(f.modals[0].content, /系统浏览器/);
  assert.equal(f.page.data.authorizationStatus, "none");
  f.page.onHide(); await f.page.onShow();
  assert.equal(f.page.data.authorizationStatus, "none");
  status = "active";
  f.page.onHide(); await f.page.onShow();
  assert.equal(f.page.data.authorizationStatus, "active");
});

test("4.14 expired/malformed links and clipboard denial never indicate authorization or a copied link", async () => {
  for (const result of [
    { scheme: "weixin://dl/business/?t=abc", expireTime: 0 },
    { scheme: "weixin://dl/business/?t=abc", expireTime: null },
    { scheme: "javascript:alert(1)", expireTime: -1 }
  ]) {
    const f = setup(600, { start: () => ({ method: "urlScheme", ...result }) });
    await f.page.load(); await f.page.authorizeWechat();
    assert.equal(f.clipboard.length, 0); assert.equal(f.modals.length, 0);
    assert.notEqual(f.page.data.authorizationStatus, "active");
  }
  const f = setup(600, { clipboardError: true, start: () => ({ method: "urlScheme", scheme: "weixin://dl/business/?t=abc", expireTime: -1 }) });
  await f.page.load(); await f.page.authorizeWechat();
  assert.equal(f.modals.length, 0); assert.equal(f.page.data.submitting, false);
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

test("withdraw page retains channel caps and history but does not expose retired daily limits or fees", async () => {
  const { page, requests } = setup();
  await page.load();
  assert.equal(page.data.withdrawRules.minAmount, undefined);
  assert.equal(page.data.withdrawRules.maxAmount, 200);
  assert.equal(page.data.withdrawRules.feePercent, undefined);
  assert.equal(page.data.withdrawRules.dailyCount, undefined);
  assert.equal(page.data.withdrawRules.dailyAmount, undefined);
  assert.equal(page.data.rows[0].statusText, "审核中");
  assert.equal(page.data.rows[1].reason, "请核对收款信息");

  page.input({ detail: { value: "451" } });
  assert.equal(page.data.withdrawAmountError, "单笔提现金额不能超过 ¥200");
  await page.submit();
  assert.equal(requests.some(item => item.url === "/api/withdrawals" && item.options?.method === "POST"), false);
});

test("withdraw page accepts a sub-yuan balance despite old minimum config", async () => {
  const { page, requests } = setup(0.5, { authorization: () => ({ required: true, status: "active" }) });
  await page.load();
  assert.equal(page.data.noWithdrawableBalance, false);
  page.input({ detail: { value: "0.5" } });
  assert.equal(page.data.withdrawAmountError, "");
  assert.equal(page.data.withdrawPreview.amount, "0.50");
  assert.equal(page.data.withdrawPreview.fee, "0.00");
  assert.equal(page.data.withdrawPreview.arrivalAmount, "0.50");
  await page.submit();
  const submitted = requests.find(item => item.url === "/api/withdrawals" && item.options?.method === "POST");
  assert.equal(submitted.options.data.amount, 0.5);
  assert.equal(page.data.withdrawPreview, null);
});

test("empty balance and invalid channel amounts cannot submit", async () => {
  const { page, requests, toasts } = setup(0);
  await page.load();
  assert.equal(page.data.noWithdrawableBalance, true);
  await page.submit();
  assert.equal(toasts.at(-1).title, "暂无可提现余额");
  assert.equal(requests.some(item => item.url === "/api/withdrawals" && item.options?.method === "POST"), false);
  const funded = setup(0.5);
  await funded.page.load();
  assert.match(funded.page.amountError("0.09"), /渠道/);
  assert.equal(funded.page.amountError("0.10"), "");
  assert.match(funded.page.amountError("0.101"), /两位小数/);
  const template = fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/service/index.wxml"), "utf8");
  assert.doesNotMatch(template, /最低提现|最低金额|balanceBelowMinimum/);
});

test("withdrawal preview clears invalid input and has no fee even when older config specifies a rate", async () => {
  const { page } = setup(600);
  await page.load();
  page.input({ detail: { value: "123.45" } });
  assert.equal(page.data.withdrawPreview.amount, "123.45");
  assert.equal(page.data.withdrawPreview.arrivalAmount, "123.45");
  assert.equal(page.data.withdrawPreview.fee, "0.00");
  for (const raw of ["", "0", "0.09", "200.01", "0.101", "abc"]) {
    page.input({ detail: { value: raw } });
    assert.equal(page.data.withdrawPreview, null);
  }
  const template = fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/service/index.wxml"), "utf8");
  assert.doesNotMatch(template, /每日次数|每日额度|withdrawLimitReached|10\s*分钟/);
  assert.match(template, /预计到账：¥\{\{withdrawPreview.arrivalAmount\}\}/);
  assert.match(template, /代扣的税费/);
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
