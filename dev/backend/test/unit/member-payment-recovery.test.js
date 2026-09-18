process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createSeed } = require("../../src/data/seed");
const payments = require("../../src/services/payment-service");

test("member payment survives new request keys and only allows renewal after settlement", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  const options = { months: 1, channel: "lfwin_wechat_mini" };
  const first = payments.createMemberPayment(state, user, { ...options, idempotencyKey: "first" });
  const next = payments.createMemberPayment(state, user, { ...options, idempotencyKey: "reopened" });
  assert.equal(next.payment.id, first.payment.id);
  assert.equal(next.idempotent, true);
  assert.equal(payments.createMemberPayment(state, user, { ...options, months: 2 }).status, 409);
  const other = state.users.find(item => item.id !== user.id);
  assert.notEqual(payments.createMemberPayment(state, other, options).payment.id, first.payment.id);
  first.payment.status = "paid";
  assert.notEqual(payments.createMemberPayment(state, user, { ...options, idempotencyKey: "renewal" }).payment.id, first.payment.id);
});

test("resuming an already paid provider order queries before invoking native payment", async () => {
  const calls = [];
  const context = { module: { exports: {} }, require: () => ({ request: async url => {
    calls.push(url); return { payment: { status: "paid" } };
  } }), wx: { requestPayment() { assert.fail("Already paid order must not invoke payment"); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/payment.js"), "utf8"), context);
  const result = await context.module.exports.pay({ payNo: "member-1", status: "pending", metadata: { lfwin: { providerOrderNo: "provider-1" } } });
  assert.equal(result.status, "paid");
  assert.deepEqual(calls, ["/api/payments/member-1/lfwin/query"]);
});

test("reopened membership page loads pending orders and queries without creating payment", async () => {
  let page;
  let settled = false;
  const calls = [];
  const pending = { payNo: "member-1", payScene: "member_open", status: "pending", metadata: { months: 1, lfwin: { providerOrderNo: "provider-1" } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/membership/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("/api") ? { request: async url => {
      calls.push(url);
      if (url === "/api/me") return { id: "alice", isMember: settled };
      if (url === "/api/config") return { membershipMonthlyPrice: 19.9 };
      if (url === "/api/payments") return settled ? [] : [pending];
      if (url.endsWith("/query")) { settled = true; return { payment: { status: "paid" } }; }
      assert.fail(`Unexpected request: ${url}`);
    } } : { pay() { assert.fail("Query should not invoke payment"); } },
    wx: { showToast() {}, getStorageSync: key => ({ tgg_user: { id: "alice" }, tgg_token: "token" })[key] }
  });
  page.setData = data => Object.assign(page.data, data);
  await page.load();
  assert.equal(page.data.payments[0].payNo, "member-1");
  await page.subscribe();
  assert.equal(calls.includes("/api/member/payments"), false);
  page.key = "previous-attempt";
  await page.queryPayment({ currentTarget: { dataset: { payNo: "member-1" } } });
  assert.equal(page.key, null);
  assert.equal(page.data.user.isMember, true);
  assert.equal(page.data.payments.length, 0);
});

test("membership account switch prevents old subscription response from invoking payment", async () => {
  let page, release;
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token" };
  const native = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/membership/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("/api") ? { request: async url => {
      if (url === "/api/me") return { id: storage.tgg_user.id };
      if (url === "/api/config") return { membershipMonthlyPrice: 19.9 };
      if (url === "/api/payments") return [];
      return new Promise(resolve => { release = resolve; });
    } } : { pay: async payment => native.push(payment) },
    wx: { getStorageSync: key => storage[key], showToast() {} }
  });
  page.setData = value => Object.assign(page.data, value);
  await page.load();
  const subscribing = page.subscribe();
  assert.ok(page.key);
  storage.tgg_user = { id: "bob" };
  await page.load();
  assert.equal(page.key, null);
  release({ payNo: "alice-payment" }); await subscribing;
  assert.equal(native.length, 0);
  assert.equal(page.data.user.id, "bob");
  assert.equal(page.data.busy, false);
});

test("membership failed refresh clears old user and pending payments and disables resume", async () => {
  let page;
  let fail = false;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/membership/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("/api") ? { request: async url => {
      if (fail) throw new Error("offline");
      if (url === "/api/me") return { id: "alice" };
      if (url === "/api/config") return { membershipMonthlyPrice: 19.9 };
      return [{ payNo: "pending", status: "pending", payScene: "member_open" }];
    } } : { pay() { assert.fail("Failed loading must disable payment"); } },
    wx: { getStorageSync: key => ({ tgg_user: { id: "alice" }, tgg_token: "token" })[key], showToast() {} }
  });
  page.setData = value => Object.assign(page.data, value);
  await page.load(); assert.equal(page.data.payments.length, 1);
  fail = true;
  await page.load();
  assert.equal(page.data.user, null); assert.equal(page.data.payments.length, 0);
  assert.equal(page.data.error, "offline");
  await page.resume({ currentTarget: { dataset: { payNo: "pending" } } });
});
