const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.TGG_STORE_MODE = "memory";
const { resetState } = require("../../src/data/store");
const auth = require("../../src/services/auth-service");
const growth = require("../../src/services/growth-service");
const { loadSQLiteState, saveSQLiteState } = require("../../src/data/sqlite-store");

test("WeChat registration binds invite once, grants trial and survives SQLite reload", async t => {
  const oldAppid = process.env.WECHAT_APPID;
  const oldSecret = process.env.WECHAT_APPSECRET;
  const oldFetch = global.fetch;
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of [["WECHAT_APPID", oldAppid], ["WECHAT_APPSECRET", oldSecret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.WECHAT_APPID = "test-app";
  process.env.WECHAT_APPSECRET = "test-secret";
  global.fetch = async () => ({ json: async () => ({ openid: "test-openid-registration" }) });
  const state = resetState();
  const inviter = state.users[0];
  const initial = inviter.points;
  const first = await auth.wechatLogin(state, { code: "test-code", inviteCode: inviter.inviteCode });
  assert.equal(first.ok, true);
  assert.ok(first.user.inviteCode);
  assert.equal(first.user.isMember, true);
  assert.equal(inviter.points, initial + state.config.inviteRewardPoints);
  const again = await auth.wechatLogin(state, { code: "another-code", inviteCode: inviter.inviteCode });
  assert.equal(again.user.id, first.user.id);
  assert.equal(inviter.points, initial + state.config.inviteRewardPoints);
  assert.equal(state.inviteRelations.filter(row => row.inviteeUserId === first.user.id).length, 1);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-wechat-"));
  const dbFile = path.join(directory, "state.sqlite");
  saveSQLiteState(state, dbFile);
  const restored = loadSQLiteState(dbFile);
  assert.equal(restored.users.find(row => row.id === first.user.id).wechatOpenid, "test-openid-registration");
  const relogin = await auth.wechatLogin(restored, { code: "after-restart" });
  assert.equal(relogin.user.id, first.user.id);
});

test("invite commission shows percentage and attributes ledger by submission", () => {
  const state = resetState();
  const [inviter, invitee] = state.users;
  state.inviteRelations = [{ inviterUserId: inviter.id, inviteeUserId: invitee.id, boundAt: new Date().toISOString() }];
  state.submissions = [{ id: "submission-proof", userId: invitee.id }];
  state.pointLedger = [{ userId: inviter.id, changeType: "invite_commission", bizNo: "submission-proof", points: 7 }];
  assert.equal(growth.getInviteInfo(state, inviter).rewardRatio, 10);
  assert.equal(growth.listInviteUsers(state, inviter)[0].contributed, 7);
});
