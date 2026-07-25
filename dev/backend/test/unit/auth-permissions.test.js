const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { issueToken, requireAdminPermission, resolveUser } = require("../../src/domain/auth");
const authService = require("../../src/services/auth-service");

function reqWithRole(state, roleId) {
  const token = tokenWithSession(state, { type: "admin", roleId });
  return { headers: { authorization: `Bearer ${token}` } };
}

function tokenWithSession(state, subject) {
  const token = issueToken(subject);
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  state.authSessions.unshift({
    id: `test_${payload.tokenId}`,
    subjectType: payload.type,
    subjectId: payload.type === "admin" ? payload.roleId : payload.userId,
    tokenId: payload.tokenId,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    revokedAt: "",
    lastSeenAt: ""
  });
  return token;
}

test("super admin has all permissions", () => {
  const state = createSeed();
  const result = requireAdminPermission(reqWithRole(state, "super_admin"), state, "ledger:read");

  assert.equal(result.ok, true);
  assert.equal(result.role.id, "super_admin");
});

test("customer service can read orders", () => {
  const state = createSeed();
  const result = requireAdminPermission(reqWithRole(state, "customer_service"), state, "order:read");

  assert.equal(result.ok, true);
});

test("customer service cannot read financial ledgers", () => {
  const state = createSeed();
  const result = requireAdminPermission(reqWithRole(state, "customer_service"), state, "ledger:read");

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.role, "customer_service");
});

test("finance admin can read ledgers and exceptions", () => {
  const state = createSeed();

  assert.equal(requireAdminPermission(reqWithRole(state, "finance_admin"), state, "ledger:read").ok, true);
  assert.equal(requireAdminPermission(reqWithRole(state, "finance_admin"), state, "exception:read").ok, true);
});

test("unknown admin role is rejected", () => {
  const state = createSeed();
  const result = requireAdminPermission(reqWithRole(state, "ghost"), state, "order:read");

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.role, "unknown");
});

test("missing admin token is rejected", () => {
  const state = createSeed();
  const result = requireAdminPermission({ headers: {} }, state, "order:read");

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("user token resolves active user", () => {
  const state = createSeed();
  const token = tokenWithSession(state, { type: "user", userId: "u_1002" });
  const result = resolveUser({ headers: { authorization: `Bearer ${token}` } }, state);

  assert.equal(result.ok, true);
  assert.equal(result.user.id, "u_1002");
});

test("logout revokes current token session", () => {
  const state = createSeed();
  const login = authService.login(state, { userId: "u_1001", password: "123456" });
  const req = { headers: { authorization: `Bearer ${login.token}` } };

  assert.equal(resolveUser(req, state).ok, true);
  assert.equal(authService.logout(state, req).ok, true);
  assert.equal(resolveUser(req, state).ok, false);
});

test("refresh rotates refresh token and keeps session active", () => {
  const state = createSeed();
  const login = authService.login(state, { userId: "u_1001", password: "123456" });

  const refreshed = authService.refresh(state, { refreshToken: login.refreshToken }, "user");
  assert.equal(refreshed.ok, true);
  assert.ok(refreshed.token);
  assert.ok(refreshed.refreshToken);
  assert.notEqual(refreshed.refreshToken, login.refreshToken);

  const req = { headers: { authorization: `Bearer ${refreshed.token}` } };
  assert.equal(resolveUser(req, state).ok, true);

  const reused = authService.refresh(state, { refreshToken: login.refreshToken }, "user");
  assert.equal(reused.ok, false);
  assert.equal(reused.status, 401);
});

test("failed admin login locks role temporarily", () => {
  const state = createSeed();
  let result;
  for (let index = 0; index < 5; index += 1) {
    result = authService.adminLogin(state, { roleId: "finance_admin", password: "wrong" });
  }

  assert.equal(result.ok, false);
  assert.equal(result.status, 423);
  assert.ok(state.authLoginAttempts.find((item) => item.subjectType === "admin" && item.subjectId === "finance_admin").lockedUntil);
  const locked = authService.adminLogin(state, { roleId: "finance_admin", password: "123456" });
  assert.equal(locked.status, 423);
});
