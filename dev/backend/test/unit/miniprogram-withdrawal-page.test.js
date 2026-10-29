const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(balance = 600) {
  const requests = [];
  const toasts = [];
  let page;
  const now = new Date().toISOString();
  const rows = [
    { id: "wd-pending", amount: 50, status: "pending_review", createdAt: now },
    { id: "wd-rejected", amount: 70, status: "rejected", reason: "请核对收款信息", createdAt: now }
  ];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/service/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ request: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/me") return { withdrawableBalance: balance };
      if (url === "/api/config") return { withdrawMinAmount: 1, withdrawFeeRate: 0.01, withdrawDailyCountLimit: 2, withdrawDailyAmountLimit: 500, deliveryTimeZone: "Asia/Shanghai" };
      if (url === "/api/withdrawals" && !options) return rows;
      return { ok: true };
    } }),
    wx: { showToast: value => toasts.push(value) }
  });
  page.setData = value => Object.assign(page.data, value);
  page.type = "withdraw";
  page.setData({ type: "withdraw" });
  return { page, requests, toasts };
}

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
  assert.equal(page.data.withdrawAmountError, "提现金额超过今日剩余额度");
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
