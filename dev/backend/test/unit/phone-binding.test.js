const test = require("node:test");
const assert = require("node:assert/strict");
process.env.TGG_STORE_MODE = "memory";
const { resetState } = require("../../src/data/store");
const auth = require("../../src/services/auth-service");
const { bindPhone, verifiedPhone } = require("../../src/services/phone-binding-service");
const { getMemberCode } = require("../../src/services/member-code-service");
const { routeApi } = require("../../src/routes/api-router");

function providers(t, { phone = "13912345678", fail = false } = {}) {
  const original = { fetch: global.fetch, app: process.env.WECHAT_APPID, secret: process.env.WECHAT_APPSECRET };
  process.env.WECHAT_APPID = "test-app"; process.env.WECHAT_APPSECRET = "secret";
  global.fetch = async url => ({ ok: true, json: async () => url.includes("jscode2session") ? { openid: "new-openid" }
    : url.includes("stable_token") ? { access_token: "access" }
    : fail ? { errcode: 40029 } : { phone_info: { purePhoneNumber: phone, countryCode: "86", watermark: { appid: "test-app" } } } });
  t.after(() => {
    global.fetch = original.fetch;
    for (const [key, value] of [["WECHAT_APPID", original.app], ["WECHAT_APPSECRET", original.secret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}
test("missing or invalid phone authorization cannot register a user or grant trial/invite rewards", async t => {
  providers(t, { fail: true });
  const state = resetState(), before = JSON.stringify(state);
  for (const input of [{ code: "wx" }, { code: "wx", phoneCode: "invalid", phone: "13912345678" }]) {
    assert.equal((await auth.wechatLogin(state, input)).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
});
test("concurrent authorized registrations create one account and do not duplicate invite rewards", async t => {
  providers(t);
  const state = resetState(), inviter = state.users[0], points = inviter.points;
  const input = { code: "wx", phoneCode: "phone-code", inviteCode: inviter.inviteCode };
  const [a, b] = await Promise.all([auth.wechatLogin(state, input), auth.wechatLogin(state, input)]);
  assert.equal(a.ok, true); assert.equal(a.user.id, b.user.id);
  assert.equal(state.users.filter(user => user.wechatOpenid === "new-openid").length, 1);
  assert.equal(inviter.points, points + state.config.inviteRewardPoints);
  const user = state.users.find(user => user.id === a.user.id);
  assert.equal(verifiedPhone(state, user).phone, "13912345678");
  assert.equal(getMemberCode(state, user).body.needsPhoneAuthorization, false);
  assert.equal(state.config.pospalIntegration.membershipSyncJobs[user.id].revision, 1);
});
test("phone binding rejects raw input, other owners and pending POS mismatch without overwriting accounts", async t => {
  providers(t);
  for (const mode of ["raw", "other-owner", "existing-phone", "pending-pos"]) {
    const state = resetState(), user = state.users[0];
    delete user.phone;
    if (mode === "other-owner") state.users[1].phone = "13912345678";
    if (mode === "existing-phone") user.phone = "13812345678";
    if (mode === "pending-pos") state.config.pospalIntegration = { memberProvisions: { [user.id]: { phone: "13812345678" } } };
    const before = JSON.stringify(state);
    const result = await bindPhone(state, user, mode === "raw" ? { phone: "13912345678" } : { phoneCode: "phone-code" });
    assert.ok(result.status >= 400, mode); assert.equal(JSON.stringify(state), before);
  }
});
test("binding a phone keeps the same user, points, membership and avatar; route requires authentication", async t => {
  providers(t);
  const state = resetState(), user = state.users[0]; delete user.phone;
  const before = { ...user };
  const result = await bindPhone(state, user, { phoneCode: "phone-code" });
  assert.equal(result.status, 200);
  assert.deepEqual(user, { ...before, phone: "13912345678" });
  assert.equal(state.config.pospalIntegration.membershipSyncJobs[user.id].memberUntil, before.memberUntil);
  let status;
  await routeApi({ method: "POST", headers: {}, async *[Symbol.asyncIterator]() { throw new Error("must not read body"); } },
    { writeHead(code) { status = code; }, end() {} }, new URL("http://localhost/api/me/phone"));
  assert.equal(status, 401);
});

test("registration with no gift days does not queue a new POSPAL customer", async t => {
  providers(t);
  const state = resetState(); state.config.newUserMemberDays = 0;
  const result = await auth.wechatLogin(state, { code: "wx", phoneCode: "phone-code" });
  assert.equal(result.ok, true); assert.equal(result.user.isMember, false);
  assert.equal(state.config.pospalIntegration?.membershipSyncJobs?.[result.user.id], undefined);
});
