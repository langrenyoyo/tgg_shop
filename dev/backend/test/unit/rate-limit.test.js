const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRateLimit, cleanupRateLimit } = require("../../src/http/rate-limit");

function request(ip, headers = {}) {
  return { method: "POST", headers, socket: { remoteAddress: ip } };
}

test("authentication endpoints are rate limited per client IP", () => {
  const url = new URL("https://example.com/api/admin/auth/login");
  const now = 1_700_000_000_000;
  for (let i = 0; i < 12; i++) assert.equal(checkRateLimit(request("198.51.100.10"), url, now).ok, true);
  const limited = checkRateLimit(request("198.51.100.10"), url, now);
  assert.equal(limited.status, 429);
  assert.ok(limited.retryAfter >= 1);
  assert.equal(checkRateLimit(request("198.51.100.11"), url, now).ok, true);
  assert.equal(checkRateLimit(request("198.51.100.10"), url, now + 60_001).ok, true);
  cleanupRateLimit(now + 60_001);
});

test("test requests without a network socket do not share a global bucket", () => {
  const url = new URL("https://example.com/api/auth/login");
  for (let i = 0; i < 20; i++) assert.equal(checkRateLimit({ method: "POST", headers: {} }, url).ok, true);
});

test("trusted reverse proxy rate limits by forwarded client address", t => {
  const previous = process.env.TGG_TRUST_PROXY;
  process.env.TGG_TRUST_PROXY = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.TGG_TRUST_PROXY;
    else process.env.TGG_TRUST_PROXY = previous;
  });

  const url = new URL("https://example.com/api/admin/auth/login");
  const proxy = request("127.0.0.1", { "x-forwarded-for": "198.51.100.20" });
  for (let i = 0; i < 12; i++) assert.equal(checkRateLimit(proxy, url, 1_800_000_000_000).ok, true);
  assert.equal(checkRateLimit(proxy, url, 1_800_000_000_000).status, 429);
  assert.equal(checkRateLimit(request("127.0.0.1", { "x-forwarded-for": "198.51.100.21" }), url, 1_800_000_000_000).ok, true);
  cleanupRateLimit(1_800_000_060_001);
});

test("forwarded client address is ignored when the direct peer is not loopback", t => {
  const previous = process.env.TGG_TRUST_PROXY;
  process.env.TGG_TRUST_PROXY = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.TGG_TRUST_PROXY;
    else process.env.TGG_TRUST_PROXY = previous;
  });

  const url = new URL("https://example.com/api/admin/auth/login");
  const direct = (forwarded) => request("198.51.100.40", { "x-forwarded-for": forwarded });
  const now = 1_900_000_000_000;
  for (let i = 0; i < 12; i++) assert.equal(checkRateLimit(direct(`198.51.100.${i + 1}`), url, now).ok, true);
  assert.equal(checkRateLimit(direct("203.0.113.99"), url, now).status, 429);
  cleanupRateLimit(now + 60_001);
});
