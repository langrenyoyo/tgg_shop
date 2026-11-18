const test = require("node:test");
const assert = require("node:assert/strict");
process.env.TGG_STORE_MODE = "memory";
const { getMemberCode } = require("../../src/services/member-code-service");

test("POS code preserves exact card number and never invents an association", () => {
  const user = { id: "u1", pospalUid: "pos1", pospalNumber: "0012345678" };
  const state = { users: [user], config: {} };
  assert.deepEqual(getMemberCode(state, user).body, { available: true, userId: "u1", number: "0012345678", format: "CODE128" });
  assert.equal(getMemberCode(state, null).status, 401);
  for (const number of [undefined, "", 1234, "a\nb", "会员123", "a".repeat(33)]) {
    assert.equal(getMemberCode(state, { ...user, pospalNumber: number }).body.available, false);
  }
  state.users.push({ id: "u2", pospalUid: "other", pospalNumber: user.pospalNumber });
  assert.equal(getMemberCode(state, user).body.available, false);
  state.users.pop();
  state.config.pospalIntegration = { customerMappings: [{ tggUserId: user.id, pospalUid: "old", number: "old" }] };
  assert.equal(getMemberCode(state, user).body.available, false);
});

test("member code endpoint requires auth and ignores requested user IDs", async () => {
  const { resetState } = require("../../src/data/store");
  const { routeApi } = require("../../src/routes/api-router");
  const state = resetState(), user = state.users[0];
  Object.assign(user, { pospalUid: "code-test", pospalNumber: "00123456", passwordHash: require("../../src/domain/admin-accounts").hashAdminPassword("123456") });
  const session = require("../../src/services/auth-service").login(state, { userId: user.id, password: "123456" });
  assert.equal(session.ok, true);
  let status, body, headers;
  const res = { writeHead(s, h) { status = s; headers = h; }, end(v) { body = JSON.parse(v); } };
  const url = new URL("http://localhost/api/me/member-code?userId=someone-else");
  await routeApi({ method: "GET", headers: {} }, res, url);
  assert.equal(status, 401);
  await routeApi({ method: "POST", headers: {}, async *[Symbol.asyncIterator]() { throw new Error("must authenticate before reading body"); } }, res, url);
  assert.equal(status, 401);
  await routeApi({ method: "GET", headers: { authorization: `Bearer ${session.token}` } }, res, url);
  assert.equal(status, 200); assert.equal(body.userId, user.id); assert.equal(body.number, "00123456");
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(body.pospalUid, undefined);
});

test("active membership without POS identity gives association guidance, not a purchase prompt", () => {
  const user = { id: "u1", memberUntil: new Date(Date.now() + 86400000).toISOString() };
  const state = { users: [user], config: {} };
  let result = getMemberCode(state, user).body;
  assert.equal(result.available, false);
  assert.equal(result.isMember, true);
  assert.equal(result.reason, "provision_required");
  assert.equal(result.needsPhoneAuthorization, true);
  assert.match(result.message, /无需再次付费/);
  user.phone = "13800000000";
  result = getMemberCode(state, user).body;
  assert.equal(result.reason, "provision_required");
  user.memberUntil = "2000-01-01";
  assert.equal(getMemberCode(state, user).body.isMember, false);
});

test("existing owner mapping supplies missing mirrored fields without guessing from a phone", () => {
  const user = { id: "u1", phone: "13800000000" };
  const mapping = { tggUserId: "u1", pospalUid: "p1", number: "000123" };
  const state = { users: [user], config: { pospalIntegration: { customerMappings: [mapping] } } };
  const before = JSON.stringify(state);
  assert.equal(getMemberCode(state, user).body.number, "000123");
  assert.equal(JSON.stringify(state), before);
  user.pospalUid = "different";
  assert.equal(getMemberCode(state, user).body.reason, "association_conflict");
  delete user.pospalUid;
  state.config.pospalIntegration.customerMappings.push({ ...mapping });
  assert.equal(getMemberCode(state, user).body.reason, "association_conflict");
  state.config.pospalIntegration.customerMappings = [{ ...mapping, tggUserId: "other", phone: user.phone }];
  assert.equal(getMemberCode(state, user).body.available, false);
});
