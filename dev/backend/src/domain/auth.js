const crypto = require("node:crypto");
const { ensureAdminUsers, effectiveRole } = require("./admin-accounts");

const TOKEN_TTL_SECONDS = Number(process.env.TGG_AUTH_TOKEN_TTL_SECONDS || 60 * 60 * 8);
const AUTH_SECRET = process.env.TGG_AUTH_SECRET || "tgg-shop-dev-auth-secret";

function issueToken(subject) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...subject,
    tokenId: subject.tokenId || crypto.randomUUID(),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, status: 401, error: "请先登录" };
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || !safeEqual(signature, sign(encodedPayload))) {
    return { ok: false, status: 401, error: "登录状态无效" };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, status: 401, error: "登录状态已过期" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, status: 401, error: "登录状态无效" };
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function resolveUser(req, state) {
  const verified = verifyToken(getBearerToken(req));
  if (!verified.ok) return verified;
  if (verified.payload.type !== "user") return { ok: false, status: 401, error: "请使用用户账号登录" };
  const session = findActiveSession(state, verified.payload);
  if (!session) return { ok: false, status: 401, error: "登录会话已失效" };
  session.lastSeenAt = new Date().toISOString();
  const user = state.users.find((item) => item.id === verified.payload.userId);
  if (!user || user.status === "disabled") return { ok: false, status: 401, error: "用户不存在或已禁用" };
  return { ok: true, user, auth: verified.payload };
}

function resolveAdmin(req, state) {
  const verified = verifyToken(getBearerToken(req));
  if (!verified.ok) return verified;
  if (verified.payload.type !== "admin") return { ok: false, status: 401, error: "请使用后台账号登录" };
  const session = findActiveSession(state, verified.payload);
  if (!session) return { ok: false, status: 401, error: "后台登录会话已失效" };
  session.lastSeenAt = new Date().toISOString();
  const account = ensureAdminUsers(state).find(item => item.id === (verified.payload.adminId || verified.payload.roleId));
  if (!account || account.status !== "active") return { ok: false, status: 401, error: "管理员不存在或已禁用" };
  return { ok: true, role: effectiveRole(state, account), adminId: account.id, auth: verified.payload };
}

function resolveStation(req, state) {
  const verified = verifyToken(getBearerToken(req));
  if (!verified.ok) return verified;
  if (verified.payload.type !== "station") return { ok: false, status: 401, error: "请使用站点账号登录" };
  const session = findActiveSession(state, verified.payload);
  if (!session) return { ok: false, status: 401, error: "站点登录会话已失效" };
  session.lastSeenAt = new Date().toISOString();
  const account = (state.stationAccounts || []).find((item) => item.id === verified.payload.stationId);
  if (!account || account.status === "disabled") return { ok: false, status: 401, error: "站点账号不存在或已停用" };
  return { ok: true, account, auth: verified.payload };
}

function findActiveSession(state, payload) {
  const subjectId = payload.type === "admin" ? (payload.adminId || payload.roleId) : payload.type === "station" ? payload.stationId : payload.userId;
  const now = Date.now();
  return (state.authSessions || []).find((session) =>
    session.tokenId === payload.tokenId
    && session.subjectType === payload.type
    && session.subjectId === subjectId
    && !session.revokedAt
    && new Date(session.expiresAt).getTime() > now
  );
}

function hasPermission(role, permission) {
  if (!role) return false;
  return role.permissions.includes("*") || role.permissions.includes(permission);
}

function requireAdminPermission(req, state, permission) {
  const admin = resolveAdmin(req, state);
  if (!admin.ok) {
    return { ok: false, status: admin.status, error: admin.error, role: "unknown" };
  }
  if (!hasPermission(admin.role, permission)) {
    return {
      ok: false,
      status: 403,
      error: `当前角色无权限 ${permission}`,
      role: admin.role.id
    };
  }
  return { ok: true, role: admin.role, adminId: admin.adminId, auth: admin.auth };
}

function publicRole(role) {
  if (!role) return null;
  return {
    id: role.id,
    name: role.name,
    permissions: role.permissions
  };
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = {
  issueToken,
  verifyToken,
  getBearerToken,
  resolveUser,
  resolveAdmin,
  resolveStation,
  requireAdminPermission,
  publicRole
};
