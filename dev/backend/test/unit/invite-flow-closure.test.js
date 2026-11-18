process.env.TGG_STORE_MODE = "memory";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { resetState } = require("../../src/data/store");
const { routeApi } = require("../../src/routes/api-router");
const auth = require("../../src/services/auth-service");
const growth = require("../../src/services/growth-service");
const admin = require("../../src/services/admin-service");
const { handleTaskCallback } = require("../../src/domain/task-callback-rules");
const miniRoot = path.resolve(__dirname, "../../../../wechat-miniprogram");

function providers(t) {
  const calls = [];
  const previous = { fetch: global.fetch, app: process.env.WECHAT_APPID, secret: process.env.WECHAT_APPSECRET };
  process.env.WECHAT_APPID = "invite-flow-test"; process.env.WECHAT_APPSECRET = "test-only";
  global.fetch = async (url, options = {}) => {
    assert.ok(url.startsWith("https://api.weixin.qq.com/"), "test must never call a live provider");
    const body = JSON.parse(options.body || "{}");
    calls.push({ url, body });
    if (url.includes("getwxacodeunlimit")) return new Response(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1kAAAAASUVORK5CYII=", "base64"));
    const code = new URL(url).searchParams.get("js_code");
    const data = url.includes("jscode2session") ? { openid: "invite-flow-" + code }
      : url.includes("stable_token") ? { access_token: "test-only" }
      : body.code === "denied" ? { errcode: 40029 }
      : { phone_info: { purePhoneNumber: body.code === "phone-b" ? "13912345002" : "13912345001", countryCode: "86", watermark: { appid: "invite-flow-test" } } };
    return { ok: true, json: async () => data };
  };
  t.after(() => {
    global.fetch = previous.fetch;
    for (const [key, value] of [["WECHAT_APPID", previous.app], ["WECHAT_APPSECRET", previous.secret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return calls;
}

let requestId = 0;
async function api(url, options = {}, token) {
  let status, body;
  const req = { method: options.method || "GET", headers: token ? { authorization: "Bearer " + token } : {}, socket: { remoteAddress: "invite-test-" + ++requestId },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(options.data || {})); } };
  await routeApi(req, { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } }, new URL("http://localhost" + url));
  if (status >= 400) throw Object.assign(new Error(body.error), { status });
  return body;
}

function runtime(storage, code = "new-user") {
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    login: ({ success }) => success({ code }), switchTab() {}, showToast() {}, reLaunch() {}, navigateBack() {}
  };
  const request = (url, options) => api(url, options, storage.get("tgg_token"));
  const apiModule = { request, resolveAssetUrl: value => value || "", saveSession: result => { storage.set("tgg_token", result.token); storage.set("tgg_user", result.user); } };
  const context = vm.createContext({ wx, module: { exports: {} }, require: name => name === "./api" ? apiModule : { mergeGuestCart() {} } });
  vm.runInContext(fs.readFileSync(path.join(miniRoot, "utils/auth.js"), "utf8"), context);
  const login = context.module.exports.wechatLogin;
  function page(file, modules) {
    let value;
    vm.runInNewContext(fs.readFileSync(path.join(miniRoot, file), "utf8"), {
      wx, Page: object => { value = object; }, getCurrentPages: () => [{}],
      require: modules || (() => apiModule)
    });
    value.setData = update => Object.assign(value.data, update);
    return value;
  }
  let app;
  vm.runInNewContext(fs.readFileSync(path.join(miniRoot, "app.js"), "utf8"), { wx, App: object => { app = object; }, require: () => ({ syncTabBarBadge() {} }) });
  return { wx, request, login, app, invitePage: () => page("pages/invite/index.js"), loginPage: () => page("pages/login/index.js", name => name.includes("utils/auth") ? { wechatLogin: login } : apiModule) };
}

test("official invitation code and share -> cold/warm launch -> registration -> reward -> list close through real API routes", async t => {
  const calls = providers(t);
  const state = resetState(), inviter = state.users[0], before = inviter.points;
  state.config.inviteRewardPoints = 3; state.config.inviteCommissionRate = 0.1;
  const session = auth.login(state, { userId: inviter.id, password: "123456" });
  assert.equal(session.ok, true);
  const sender = runtime(new Map([["tgg_user", session.user], ["tgg_token", session.token]]));
  const page = sender.invitePage(); await page.load();
  const previousCount = page.data.info.totalInvited;
  const share = page.onShareAppMessage();
  const query = Object.fromEntries(new URL("https://mini" + share.path).searchParams);
  assert.equal(query.inviteCode, inviter.inviteCode);
  const codeImage = await api("/api/invite/code?userId=other&scene=forged", {}, session.token);
  assert.equal(codeImage.userId, inviter.id);
  assert.equal(codeImage.inviteCode, inviter.inviteCode);
  const scene = calls.find(call => call.url.includes("getwxacodeunlimit")).body.scene;
  assert.equal(scene, inviter.inviteCode);
  const storage = new Map(), recipient = runtime(storage);
  recipient.app.onLaunch({ query: { scene: encodeURIComponent(scene) } }); recipient.app.onShow({ query });
  const login = recipient.loginPage(); login.onLoad(); login.setData({ agreed: true });
  await login.handleLogin({ detail: { code: "phone-a" } });
  assert.equal(login.data.error, "");
  const user = storage.get("tgg_user"); assert.ok(user?.id);
  assert.equal(storage.has("tgg_pending_invite"), false);
  assert.equal(state.inviteRelations.filter(row => row.inviteeUserId === user.id).length, 1);
  assert.equal(state.inviteRelations.find(row => row.inviteeUserId === user.id).inviterUserId, inviter.id);
  assert.equal(inviter.points, before + 3);
  const reward = state.pointLedger.filter(row => row.idempotencyKey === `invite_register:${user.id}`);
  assert.equal(reward.length, 1); assert.equal(reward[0].points, 3);
  await page.load();
  assert.equal(page.data.info.totalInvited, previousCount + 1);
  assert.ok(page.data.list.some(row => row.uid === user.id));
  assert.ok(admin.listInviteAudits(state).some(row => row.inviteeUserId === user.id));
  const relation = JSON.stringify(state.inviteRelations);
  recipient.app.onShow({ query: { inviteCode: state.users[1].inviteCode } });
  await recipient.login();
  assert.equal(JSON.stringify(state.inviteRelations), relation);
  assert.equal(inviter.points, before + 3);
  assert.equal((await api("/api/invite/list?page=1&count=20", {}, storage.get("tgg_token"))).rows.some(row => row.uid === user.id), false);
  await assert.rejects(api("/api/invite/info"), error => error.status === 401);
  await assert.rejects(api("/api/invite/code"), error => error.status === 401);
});

test("denied phone does not register or award; concurrent retry gives one relationship and reward", async t => {
  providers(t);
  const state = resetState(), inviter = state.users[0], before = JSON.stringify(state);
  const storage = new Map(), recipient = runtime(storage, "retry-user");
  recipient.app.onLaunch({ query: { inviteCode: inviter.inviteCode } });
  await assert.rejects(recipient.login({ phoneCode: "denied" }));
  assert.equal(JSON.stringify(state), before);
  assert.equal(storage.get("tgg_pending_invite"), inviter.inviteCode);
  const body = { code: "retry-user", phoneCode: "phone-a", inviteCode: inviter.inviteCode };
  const [a, b] = await Promise.all([api("/api/auth/wechat-login", { method: "POST", data: body }), api("/api/auth/wechat-login", { method: "POST", data: body })]);
  assert.equal(a.user.id, b.user.id);
  assert.equal(state.inviteRelations.filter(row => row.inviteeUserId === a.user.id).length, 1);
  assert.equal(state.pointLedger.filter(row => row.idempotencyKey === `invite_register:${a.user.id}`).length, 1);
});

test("invalid or disabled inviter can be cleared explicitly to recover registration", async t => {
  providers(t);
  for (const invalid of ["DOES-NOT-EXIST", "DISABLED-CODE"]) {
    const state = resetState(); state.users[0].inviteCode = "DISABLED-CODE"; state.users[0].status = "disabled";
    const before = JSON.stringify(state), storage = new Map(), recipient = runtime(storage);
    recipient.app.onLaunch({ query: { inviteCode: invalid } });
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(recipient.login({ phoneCode: "phone-a" }), /邀请码无效/);
    assert.equal(JSON.stringify(state), before);
    assert.equal(storage.get("tgg_pending_invite"), invalid);
    recipient.app.onShow({ query: {} });
    assert.equal(storage.get("tgg_pending_invite"), invalid);
    const page = recipient.loginPage(); page.onLoad(); page.onShow();
    assert.equal(page.data.inviteCode, invalid); page.clearInvite();
    assert.equal(storage.has("tgg_pending_invite"), false);
    page.setData({ agreed: true }); await page.handleLogin({ detail: { code: "phone-a" } });
    assert.equal(page.data.error, ""); assert.ok(storage.get("tgg_user")?.id);
    assert.equal(state.inviteRelations.some(row => row.inviteeUserId === storage.get("tgg_user").id), false);
  }
});

test("audit finding: task commission reaches inviter list but admin audit misattributes submission identifiers", async t => {
  providers(t);
  const state = resetState(), inviter = state.users[0];
  const result = await api("/api/auth/wechat-login", { method: "POST", data: { code: "commission-user", phoneCode: "phone-a", inviteCode: inviter.inviteCode } });
  const user = state.users.find(row => row.id === result.user.id), before = inviter.points;
  state.submissions.push({ id: "independent-submission-id", userId: user.id, status: "pending", taskSnapshot: { rewardPoints: 100, inviteCommissionRate: 0.1 } });
  assert.equal(handleTaskCallback(state, { id: "independent-submission-id", status: "approved" }).ok, true);
  assert.equal(inviter.points, before + 10);
  assert.equal(handleTaskCallback(state, { id: "independent-submission-id", status: "approved" }).idempotent, true);
  assert.equal(inviter.points, before + 10);
  assert.equal(growth.listInviteUsers(state, inviter).find(row => row.uid === user.id).contributed, 10);
  assert.equal(admin.listInviteAudits(state).find(row => row.inviteeUserId === user.id).commissionPoints, 0);
});

test("latest invite wins before registration; no-code registration remains valid", async t => {
  providers(t);
  const state = resetState(), storage = new Map(), recipient = runtime(storage);
  recipient.app.onLaunch({ query: { inviteCode: state.users[0].inviteCode } });
  recipient.app.onShow({ query: { inviteCode: state.users[1].inviteCode } });
  const result = await recipient.login({ phoneCode: "phone-a" });
  assert.equal(state.inviteRelations.find(row => row.inviteeUserId === result.user.id).inviterUserId, state.users[1].id);
  const noCode = await runtime(new Map(), "organic-user").login({ phoneCode: "phone-b" });
  assert.ok(noCode.user.id);
  assert.equal(state.inviteRelations.some(row => row.inviteeUserId === noCode.user.id), false);
});

test("scene parsing accepts encoded invitations, rejects malformed input, and manual entry can replace it", () => {
  const storage = new Map(), recipient = runtime(storage);
  recipient.app.onLaunch({ query: { scene: "ABC012345678" } });
  assert.equal(storage.get("tgg_pending_invite"), "ABC012345678");
  recipient.app.onShow({ query: { scene: "inviteCode%3DOTHER-CODE" } });
  assert.equal(storage.get("tgg_pending_invite"), "OTHER-CODE");
  for (const scene of ["%xx", "x".repeat(33), "a&b", 123, ""]) {
    recipient.app.onShow({ query: { scene } }); assert.equal(storage.get("tgg_pending_invite"), "OTHER-CODE");
  }
  const page = recipient.loginPage(); page.onShow(); page.editInvite({ detail: { value: "  MANUAL-CODE  " } });
  assert.equal(storage.get("tgg_pending_invite"), "MANUAL-CODE");
  page.setData({ loading: true }); page.clearInvite(); assert.equal(storage.get("tgg_pending_invite"), "MANUAL-CODE");
});

test("legacy logged-in accounts obtain a stable invitation code from info or code endpoints without registering again", async t => {
  providers(t);
  const state = resetState(), user = state.users[0]; delete user.inviteCode;
  const session = auth.login(state, { userId: user.id, password: "123456" });
  const before = JSON.stringify({ points: state.users.map(u => u.points), relations: state.inviteRelations, ledger: state.pointLedger });
  const image = await api("/api/invite/code", {}, session.token);
  assert.match(image.inviteCode, /^[A-F0-9]{12}$/);
  const info = await api("/api/invite/info", {}, session.token);
  assert.equal(image.inviteCode, info.inviteCode);
  assert.equal(info.inviteCode, user.inviteCode);
  delete user.inviteCode;
  const [a, b] = await Promise.all([api("/api/invite/info", {}, session.token), api("/api/invite/info", { method: "POST" }, session.token)]);
  assert.match(a.inviteCode, /^[A-F0-9]{12}$/); assert.equal(a.inviteCode, b.inviteCode);
  assert.equal(JSON.stringify({ points: state.users.map(u => u.points), relations: state.inviteRelations, ledger: state.pointLedger }), before);
});
