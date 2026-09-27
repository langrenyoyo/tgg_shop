process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const admin = require("../../src/services/admin-service");

const actor = { id: "admin-1", role: { id: "super_admin", permissions: ["*"] } };

test("admin can reduce a member by one month and the operation is idempotent", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  user.memberUntil = new Date(Date.now() + 90 * 86400000).toISOString();
  const before = new Date(user.memberUntil).getTime();
  const result = admin.updateUser(state, user.id, { memberMonths: -1, reason: "会员权益纠正", idempotencyKey: "member-minus-1" }, actor);
  assert.equal(result.ok, true);
  const after = new Date(user.memberUntil).getTime();
  assert.ok(after < before);
  assert.ok(before - after >= 29 * 86400000 && before - after <= 31 * 86400000);
  assert.equal(admin.updateUser(state, user.id, { memberMonths: -1, reason: "会员权益纠正", idempotencyKey: "member-minus-1" }, actor).idempotent, true);
  assert.equal(new Date(user.memberUntil).getTime(), after);
  assert.equal(state.adminOperationLogs.at(-1).detail.memberMonths, -1);
});

test("reducing a member with less than one month remaining ends membership at now", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  user.memberUntil = new Date(Date.now() + 3 * 86400000).toISOString();
  const result = admin.updateUser(state, user.id, { memberMonths: -1, reason: "到期调整", idempotencyKey: "member-minus-expire" }, actor);
  assert.equal(result.ok, true);
  assert.equal(user.memberUntil, null);
  assert.equal(user.role, "normal");
});

test("membership adjustment rejects zero, excessive negative months and conflicting clear flag", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1001");
  for (const input of [
    { memberMonths: 0 },
    { memberMonths: -13 },
    { memberMonths: -1, clearMember: true }
  ]) {
    const result = admin.updateUser(state, user.id, { ...input, reason: "校验", idempotencyKey: `invalid-${String(input.memberMonths)}-${Boolean(input.clearMember)}` }, actor);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  }
});

test("reducing a non-member is rejected without creating an audit mutation", () => {
  const state = createSeed();
  const user = state.users.find(item => item.id === "u_1002");
  const beforeLogs = state.adminOperationLogs.length;
  const result = admin.updateUser(state, user.id, { memberMonths: -1, reason: "误操作校验", idempotencyKey: "member-minus-normal" }, actor);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(state.adminOperationLogs.length, beforeLogs);
  assert.equal(user.memberUntil, null);
});
