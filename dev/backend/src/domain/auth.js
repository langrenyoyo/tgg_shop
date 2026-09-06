const crypto = require("node:crypto");

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
  const role = state.roles.find((item) => item.id === verified.payload.roleId);
  if (!role) return { ok: false, status: 401, error: "后台角色不存在" };
  return { ok: true, role, auth: verified.payload };
}

function findActiveSession(state, payload) {
  const subjectId = payload.type === "admin" ? payload.roleId : payload.userId;
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
  return { ok: true, role: admin.role, auth: admin.auth };
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
  requireAdminPermission,
  publicRole
};
