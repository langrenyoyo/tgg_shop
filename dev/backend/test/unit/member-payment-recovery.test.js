process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createSeed } = require("../../src/data/seed");
const payments = require("../../src/services/payment-service");

test("points membership has zero cash amount and retries never deduct points or extend twice", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  state.config.membershipMonthlyPoints = 100;
  user.points = 100;
  const options = { months: 1, paymentMode: "pure_points" };
  const first = payments.createMemberPayment(state, user, { ...options, idempotencyKey: "first" });
  assert.equal(first.ok, true);
  assert.equal(first.payment.amount, 0);
  assert.equal(first.payment.status, "paid");
  assert.equal(user.points, 0);
  const until = user.memberUntil;
  const next = payments.createMemberPayment(state, user, { ...options, idempotencyKey: "first" });
  assert.equal(next.payment.id, first.payment.id);
  assert.equal(next.idempotent, true);
  assert.equal(user.memberUntil, until);
  assert.equal(payments.createMemberPayment(state, user, { ...options, months: 2, idempotencyKey: "first" }).status, 409);
  const other = state.users.find(item => item.id !== user.id);
  assert.equal(payments.createMemberPayment(state, other, { ...options, idempotencyKey: "first" }).status, 409);
  user.points = 100;
  assert.notEqual(payments.createMemberPayment(state, user, { ...options, idempotencyKey: "renewal" }).payment.id, first.payment.id);
});

test("resuming an already paid provider order queries before invoking native payment", async () => {
  const calls = [];
  const context = { module: { exports: {} }, require: () => ({ request: async url => {
    calls.push(url);
    if (url === "/api/config") return { testBypassEnabled: false };
    return { payment: { status: "paid" } };
  } }), wx: { requestPayment() { assert.fail("Already paid order must not invoke payment"); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/payment.js"), "utf8"), context);
  const result = await context.module.exports.pay({ payNo: "member-1", status: "pending", metadata: { lfwin: { providerOrderNo: "provider-1" } } });
  assert.equal(result.status, "paid");
  assert.deepEqual(calls, ["/api/config", "/api/payments/member-1/lfwin/query"]);
});

test("test payment settles without invoking LFWin or native payment", async () => {
  const calls = [];
  const context = { module: { exports: {} }, require: () => ({ request: async url => {
    calls.push(url);
    if (url === "/api/config") return { testBypassEnabled: true };
    assert.equal(url, "/api/test/payments/member-test/settle");
    return { payment: { status: "paid" } };
  } }), wx: { requestPayment() { assert.fail("Test payment must not invoke native payment"); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/payment.js"), "utf8"), context);
  assert.equal((await context.module.exports.pay({ payNo: "member-test", status: "pending" })).status, "paid");
  assert.deepEqual(calls, ["/api/config", "/api/test/payments/member-test/settle"]);
});

test("membership test query is read-only and does not contact an unconfigured provider", async () => {
  let page;
  const pending = { payNo: "member-test", payScene: "member_open", status: "pending", metadata: { lfwin: { submissionState: "unknown" } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/membership/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("/api") ? { request: async (url, options) => {
      assert.equal(options?.method, undefined);
      if (url === "/api/me") return { id: "alice" };
      if (url === "/api/config") return { testBypassEnabled: true, membershipMonthlyPrice: 19.9 };
      if (url === "/api/payments") return [pending];
      assert.fail(`Unexpected provider request: ${url}`);
    } } : { pay() { assert.fail("Query must not settle a payment"); } },
    wx: { showToast() {}, getStorageSync: key => ({ tgg_user: { id: "alice" }, tgg_token: "token" })[key] }
  });
  page.setData = data => Object.assign(page.data, data);
  await page.load();
  await page.queryPayment({ currentTarget: { dataset: { payNo: pending.payNo } } });
  assert.equal(page.data.payments[0].status, "pending");
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
  await page.subscribe({ currentTarget: { dataset: { mode: "pure_points" } } });
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
  const subscribing = page.subscribe({ currentTarget: { dataset: { mode: "pure_points" } } });
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
  assert.equal(page.resume, undefined);
});

test("membership page keeps the expired-session error visible after auth clears the account", async () => {
  let page;
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token" };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/membership/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("/api") ? { request: async url => {
      if (url === "/api/me") {
        delete storage.tgg_user;
        delete storage.tgg_token;
        const error = new Error("登录已失效，请重新登录");
        error.statusCode = 401;
        throw error;
      }
      if (url === "/api/config") return { membershipMonthlyPrice: 19.9 };
      return [];
    } } : { pay() { assert.fail("Expired session must not allow payment"); } },
    wx: { showToast() {}, getStorageSync: key => storage[key] }
  });
  page.setData = value => Object.assign(page.data, value);

  await page.load();

  assert.equal(page.data.loading, false);
  assert.equal(page.data.user, null);
  assert.equal(page.data.error, "登录已失效，请重新登录");
  assert.equal(page.data.needLogin, true);
});
