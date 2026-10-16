const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRateLimit, cleanupRateLimit } = require("../../src/http/rate-limit");

function request(ip) {
  return { method: "POST", headers: {}, socket: { remoteAddress: ip } };
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
