const buckets = new Map();

const RULES = [
  { match: /^\/api\/(?:admin\/auth|station\/auth|auth)\/(?:login|wechat-login|refresh)$/, methods: ["POST"], limit: 12, windowMs: 60_000 },
  { match: /^\/api\/(?:task\/callback|payment-providers\/lfwin\/(?:notify|refund-notify)|payment\/lfwin\/refund-notify|providers\/huifu\/withdraw-callback|pospal\/callback)$/, methods: ["POST"], limit: 30, windowMs: 60_000 },
  { match: /^\/api\/(?:home|products|tasks|task-types|pickup-sites|delivery\/teams|config)$/, methods: ["GET"], limit: 180, windowMs: 60_000 }
];

function clientKey(req) {
  if (!req?.socket?.remoteAddress && !req?.connection?.remoteAddress) return null;
  if (process.env.TGG_TRUST_PROXY === "1") {
    const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
}

function checkRateLimit(req, url, now = Date.now()) {
  if (process.env.TGG_STORE_MODE === "memory" && process.env.TGG_TEST_BYPASS_ENABLED === "1") return { ok: true };
  const rule = RULES.find(item => item.match.test(url.pathname) && item.methods.includes(req.method));
  const keyPart = clientKey(req);
  if (!rule || !keyPart) return { ok: true };
  const key = `${rule.match}:${req.method}:${keyPart}`;
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > rule.limit) {
    return { ok: false, status: 429, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)), error: "请求过于频繁，请稍后重试" };
  }
  return { ok: true };
}

function cleanupRateLimit(now = Date.now()) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

const cleanupTimer = setInterval(() => cleanupRateLimit(), 5 * 60_000);
cleanupTimer.unref?.();

module.exports = { checkRateLimit, cleanupRateLimit };
