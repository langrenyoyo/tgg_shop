process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const admin = require("../../src/services/admin-service");
const account = require("../../src/services/account-service");
const { activeConfig } = require("../../src/config/active-config");

test("admin can save and publish a multiline withdrawal notice", () => {
  const state = createSeed();
  const notice = "全天可申请。\n正常情况下 10 分钟内到账。";
  const result = admin.updateConfig(state, { withdrawNotice: notice, reason: "unit test" }, { role: { id: "super_admin", permissions: ["*"] } });

  assert.equal(result.withdrawNotice, notice);
  assert.equal(activeConfig(state.config).withdrawNotice, notice);
  assert.equal(activeConfig(state.config).withdrawDailyCountLimit, 2);
  assert.equal(activeConfig(state.config).withdrawMaxAmount, 500);
  assert.equal(activeConfig(state.config).withdrawDailyAmountLimit, 500);
});

test("admin rejects invalid or oversized withdrawal notice values", () => {
  const actor = { role: { id: "super_admin", permissions: ["*"] } };
  const state = createSeed();

  assert.equal(admin.updateConfig(state, { withdrawNotice: 123, reason: "unit test" }, actor).ok, false);
  assert.equal(admin.updateConfig(state, { withdrawNotice: "文案".repeat(1001), reason: "unit test" }, actor).ok, false);
  assert.equal(state.config.withdrawNotice, createSeed().config.withdrawNotice);
  assert.equal(admin.updateConfig(state, { withdrawMinAmount: 600, withdrawMaxAmount: 500, reason: "unit test" }, actor).ok, false);
});

test("withdrawal requests enforce the per-request maximum", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  user.withdrawableBalance = 1000;
  const result = account.requestWithdrawal(state, user, { amount: 500.01, idempotencyKey: "max-amount" });

  assert.equal(result.ok, false);
  assert.match(result.error, /不能超过 500 元/);
  assert.equal(user.withdrawableBalance, 1000);
});

test("withdrawal requests allow two per day while enforcing the 500 yuan daily cap", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  user.withdrawableBalance = 1000;
  assert.equal(account.requestWithdrawal(state, user, { amount: 250, idempotencyKey: "daily-first" }).ok, true);
  assert.equal(account.requestWithdrawal(state, user, { amount: 250, idempotencyKey: "daily-second" }).ok, true);
  const result = account.requestWithdrawal(state, user, { amount: 1, idempotencyKey: "daily-third" });

  assert.equal(result.ok, false);
  assert.match(result.error, /每日最多提现 2 次/);
  assert.equal(user.withdrawableBalance, 500);
});

test("mini program renders the editable notice from public config", async () => {
  const notice = "第一条规则\n第二条规则";
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/service/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ request: async url => {
      if (url === "/api/me") return { withdrawableBalance: 20 };
      if (url === "/api/config") return { withdrawMinAmount: 1, withdrawFeeRate: 0.01, withdrawDailyCountLimit: 2, withdrawDailyAmountLimit: 500, withdrawNotice: notice, deliveryTimeZone: "Asia/Shanghai" };
      if (url === "/api/withdrawals") return [];
      throw new Error(`Unexpected request: ${url}`);
    } }),
    wx: {}
  });
  page.setData = value => Object.assign(page.data, value);
  page.type = "withdraw";
  page.setData({ type: "withdraw" });
  await page.load();

  assert.deepEqual(Array.from(page.data.withdrawNoticeLines), ["第一条规则", "第二条规则"]);
  assert.match(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/service/index.wxml"), "utf8"), /wx:for="\{\{withdrawNoticeLines\}\}"/);
});
