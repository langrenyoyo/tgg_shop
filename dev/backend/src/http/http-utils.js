const { isMember } = require("../domain/rules");
const { productionLike } = require("../config/runtime-safety");

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2);
  const requestOrigin = String(res.req?.headers?.origin || "").trim();
  const configuredOrigins = String(process.env.TGG_CORS_ORIGIN || "").split(",").map(item => item.trim()).filter(Boolean);
  const corsHeaders = configuredOrigins.length
    ? (requestOrigin && configuredOrigins.includes(requestOrigin)
      ? { "Access-Control-Allow-Origin": requestOrigin, Vary: "Origin" }
      : {})
    : productionLike()
      ? {}
      : { "Access-Control-Allow-Origin": "*" };
  res.writeHead(status, {
    "Content-Type": headers["Content-Type"] || "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...(productionLike() ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    ...corsHeaders,
    ...headers
  });
  res.end(body);
  return true;
}

async function readBody(req) {
  const chunks = [];
  const configuredLimit = Number(process.env.TGG_MAX_BODY_BYTES || 1024 * 1024);
  const maxBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1024 * 1024;
  const contentLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.resume?.();
    const error = new Error("Request body too large");
    error.status = 413;
    throw error;
  }
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(Buffer.from(chunk));
  }
  if (tooLarge) {
    const error = new Error("Request body too large");
    error.status = 413;
    throw error;
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Malformed JSON body");
    error.status = 400;
    throw error;
  }
}

function publicUser(user) {
  if (!user) return null;
  // Keep the client contract explicit. User records may contain provider IDs,
  // auth metadata, and future server-only fields that must never be serialized.
  const safeUser = {
    id: user.id,
    nickname: user.nickname,
    phone: user.phone,
    role: user.role,
    memberUntil: user.memberUntil,
    points: user.points,
    withdrawableBalance: user.withdrawableBalance,
    inviteCode: user.inviteCode,
    signinStreak: user.signinStreak,
    status: user.status,
    avatarUrl: user.avatarUrl
  };
  return {
    ...safeUser,
    isMember: isMember(user),
    memberDaysLeft: user.memberUntil
      ? Math.max(0, Math.ceil((new Date(user.memberUntil).getTime() - Date.now()) / 86400000))
      : 0
  };
}

module.exports = {
  send,
  readBody,
  publicUser
};
