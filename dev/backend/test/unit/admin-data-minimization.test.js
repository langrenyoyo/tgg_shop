process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { listUsers, listAddresses, listWithdrawals } = require("../../src/services/admin-service");

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

test("admin address and withdrawal lists omit internal provider fields", () => {
  const state = createSeed();
  state.addresses[0].internalNote = "private";
  state.withdrawRequests = [{
    id: "wd_1", userId: state.users[0].id, amount: 10, fee: 1, arrivalAmount: 9,
    status: "processing", openid: "wx-private-openid", idempotencyKey: "secret-key",
    transferPackage: { package: "private" }, providerOrderId: "provider-1"
  }];

  const [address] = listAddresses(state);
  const [withdrawal] = listWithdrawals(state);
  assert.equal(address.receiverName, state.addresses[0].receiverName);
  assert.equal(address.internalNote, undefined);
  assert.equal(withdrawal.amount, 10);
  assert.equal(withdrawal.providerOrderId, "provider-1");
  assert.equal(withdrawal.openid, undefined);
  assert.equal(withdrawal.idempotencyKey, undefined);
  assert.equal(withdrawal.transferPackage, undefined);
});
