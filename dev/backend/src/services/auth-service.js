const crypto = require("node:crypto");
const { nextId, saveState } = require("../data/store");
const { getBearerToken, issueToken, publicRole, verifyToken } = require("../domain/auth");
const { publicUser } = require("../http/http-utils");
const userRepository = require("../repositories/user-repository");

const MAX_FAILED_ATTEMPTS = Number(process.env.TGG_AUTH_MAX_FAILED_ATTEMPTS || 5);
const LOCK_MINUTES = Number(process.env.TGG_AUTH_LOCK_MINUTES || 15);
const REFRESH_TTL_DAYS = Number(process.env.TGG_AUTH_REFRESH_TTL_DAYS || 30);

function getCurrentUser(user) {
  return publicUser(user);
}

function login(state, input = {}) {
  const userId = typeof input === "string" ? input : input.userId;
  const password = typeof input === "string" ? "" : input.password;
  const nextUser = userRepository.findById(state, userId);
  if (!nextUser) return { ok: false, status: 404, error: "用户不存在" };

  const locked = assertNotLocked(state, "user", nextUser.id);
  if (!locked.ok) return locked;

  if (!isValidPassword(password)) {
    return recordFailedLogin(state, "user", nextUser.id);
  }

  clearLoginAttempts(state, "user", nextUser.id);
  userRepository.setCurrentUser(state, nextUser.id);
  const result = tokenResult(state, {
    user: publicUser(nextUser),
    tokenPayload: { type: "user", userId: nextUser.id }
  });
  saveState();
  return result;
}

function adminLogin(state, input = {}) {
  const roleId = input.roleId || input.adminId;
  const role = state.roles.find((item) => item.id === roleId);
  if (!role) return { ok: false, status: 401, error: "账号或密码错误" };

  const locked = assertNotLocked(state, "admin", role.id);
  if (!locked.ok) return locked;

  if (!isValidPassword(input.password)) {
    return recordFailedLogin(state, "admin", role.id);
  }

  clearLoginAttempts(state, "admin", role.id);
  const result = tokenResult(state, {
    role: publicRole(role),
    tokenPayload: { type: "admin", roleId: role.id }
  });
  saveState();
  return result;
}

function logout(state, req) {
  const verified = verifyToken(getBearerToken(req));
  if (!verified.ok) return verified;
  const session = (state.authSessions || []).find((item) => item.tokenId === verified.payload.tokenId && !item.revokedAt);
  if (session) {
    session.revokedAt = new Date().toISOString();
    saveState();
  }
  return { ok: true };
}

function refresh(state, input = {}, expectedType) {
  const refreshToken = String(input.refreshToken || "");
  if (!refreshToken) return { ok: false, status: 401, error: "刷新令牌不能为空" };
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const now = Date.now();
  const session = (state.authSessions || []).find((item) =>
    item.subjectType === expectedType
    && item.refreshTokenHash === refreshTokenHash
    && !item.revokedAt
    && new Date(item.refreshExpiresAt || 0).getTime() > now
  );
  if (!session) return { ok: false, status: 401, error: "刷新令牌无效或已过期" };

  const tokenPayload = session.subjectType === "admin"
    ? { type: "admin", roleId: session.subjectId, tokenId: session.tokenId }
    : { type: "user", userId: session.subjectId, tokenId: session.tokenId };
  const token = issueToken(tokenPayload);
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  const nextRefreshToken = createRefreshToken();
  const nowIso = new Date().toISOString();

  session.expiresAt = new Date(payload.exp * 1000).toISOString();
  session.lastSeenAt = nowIso;
  session.refreshTokenHash = hashRefreshToken(nextRefreshToken);
  session.refreshExpiresAt = refreshExpiresAt();
  saveState();

  return {
    ok: true,
    token,
    refreshToken: nextRefreshToken,
    expiresAt: session.expiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
    sessionId: session.id
  };
}

function tokenResult(state, input) {
  const token = issueToken(input.tokenPayload);
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  const subjectType = payload.type;
  const subjectId = subjectType === "admin" ? payload.roleId : payload.userId;
  const issuedAt = new Date(payload.iat * 1000).toISOString();
  const expiresAt = new Date(payload.exp * 1000).toISOString();
  const refreshToken = createRefreshToken();

  state.authSessions ||= [];
  state.authSessions.unshift({
    id: nextId("ses"),
    subjectType,
    subjectId,
    tokenId: payload.tokenId,
    issuedAt,
    expiresAt,
    refreshTokenHash: hashRefreshToken(refreshToken),
    refreshExpiresAt: refreshExpiresAt(),
    revokedAt: "",
    lastSeenAt: issuedAt
  });

  return {
    ok: true,
    token,
    refreshToken,
    expiresAt,
    refreshExpiresAt: state.authSessions[0].refreshExpiresAt,
    sessionId: state.authSessions[0].id,
    user: input.user,
    role: input.role
  };
}

function createRefreshToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashRefreshToken(token) {
  return crypto.createHmac("sha256", process.env.TGG_AUTH_SECRET || "tgg-shop-dev-auth-secret").update(String(token)).digest("hex");
}

function refreshExpiresAt() {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function assertNotLocked(state, subjectType, subjectId) {
  const attempt = findAttempt(state, subjectType, subjectId);
  if (!attempt?.lockedUntil) return { ok: true };
  if (new Date(attempt.lockedUntil).getTime() <= Date.now()) return { ok: true };
  return { ok: false, status: 423, error: "登录失败次数过多，账号已临时锁定", lockedUntil: attempt.lockedUntil };
}

function recordFailedLogin(state, subjectType, subjectId) {
  const now = new Date().toISOString();
  const attempt = ensureAttempt(state, subjectType, subjectId);
  attempt.failedCount = Number(attempt.failedCount || 0) + 1;
  attempt.lastFailedAt = now;
  if (attempt.failedCount >= MAX_FAILED_ATTEMPTS) {
    attempt.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
  }
  saveState();
  return {
    ok: false,
    status: attempt.lockedUntil ? 423 : 401,
    error: attempt.lockedUntil ? "登录失败次数过多，账号已临时锁定" : "账号或密码错误",
    failedCount: attempt.failedCount,
    lockedUntil: attempt.lockedUntil || ""
  };
}

function clearLoginAttempts(state, subjectType, subjectId) {
  const attempt = findAttempt(state, subjectType, subjectId);
  if (!attempt) return;
  attempt.failedCount = 0;
  attempt.lockedUntil = "";
  attempt.lastFailedAt = "";
}

function ensureAttempt(state, subjectType, subjectId) {
  state.authLoginAttempts ||= [];
  let attempt = findAttempt(state, subjectType, subjectId);
  if (!attempt) {
    attempt = { subjectType, subjectId, failedCount: 0, lockedUntil: "", lastFailedAt: "" };
    state.authLoginAttempts.push(attempt);
  }
  return attempt;
}

function findAttempt(state, subjectType, subjectId) {
  return (state.authLoginAttempts || []).find((item) => item.subjectType === subjectType && item.subjectId === subjectId);
}

function isValidPassword(password) {
  const passwordHash = process.env.TGG_DEMO_PASSWORD_HASH;
  const passwordText = String(password || "");
  if (passwordHash) return hashPassword(passwordText) === passwordHash;
  return passwordText === String(process.env.TGG_DEMO_PASSWORD || "123456");
}

function hashPassword(password) {
  const salt = process.env.TGG_PASSWORD_SALT || "tgg-shop-dev-password-salt";
  return crypto.scryptSync(String(password || ""), salt, 32).toString("hex");
}

module.exports = {
  getCurrentUser,
  login,
  adminLogin,
  refresh,
  logout,
  hashPassword
};
