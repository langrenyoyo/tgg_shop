process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { listUsers } = require("../../src/services/admin-service");

test("admin user list omits provider identities and authentication metadata", () => {
  const state = createSeed();
  state.users[0].wechatOpenid = "wx-private-openid";
  state.users[0].pospalUid = "pospal-private-id";
  state.users[0].pospalNumber = "VIP-001";
  state.users[0].passwordHash = "private-password-hash";
  state.users[0].authVersion = 4;

  const [user] = listUsers(state);
  assert.equal(user.id, state.users[0].id);
  assert.equal(user.nickname, state.users[0].nickname);
  assert.equal(user.wechatOpenid, undefined);
  assert.equal(user.pospalUid, undefined);
  assert.equal(user.pospalNumber, undefined);
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.authVersion, undefined);
});
