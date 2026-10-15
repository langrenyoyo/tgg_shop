const test = require("node:test");
const assert = require("node:assert/strict");
const accounts = require("../../src/domain/admin-accounts");

function withProductionAdminConfig(t, configuredHash = "") {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    TGG_STORE_DRIVER: process.env.TGG_STORE_DRIVER,
    TGG_ADMIN_PASSWORD_HASH: process.env.TGG_ADMIN_PASSWORD_HASH,
    TGG_DEMO_PASSWORD_HASH: process.env.TGG_DEMO_PASSWORD_HASH
  };
  process.env.NODE_ENV = "production";
  process.env.TGG_STORE_DRIVER = "pg";
  delete process.env.TGG_ADMIN_PASSWORD_HASH;
  delete process.env.TGG_DEMO_PASSWORD_HASH;
  if (configuredHash) process.env.TGG_ADMIN_PASSWORD_HASH = configuredHash;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("production replaces the known default admin hash and keeps the account disabled", t => {
  withProductionAdminConfig(t);
  const state = { adminUsers: [{ id: "super_admin", username: "super_admin", passwordHash: accounts.hashAdminPassword("123456"), status: "active" }] };
  const [account] = accounts.ensureAdminUsers(state);
  assert.equal(account.status, "disabled");
  assert.equal(accounts.verifyAdminPassword("123456", account.passwordHash), false);
  assert.equal(account.securityLockReason, "admin password provisioning required");
});

test("a provisioned production hash unlocks an account previously scrubbed by startup", t => {
  const configuredHash = accounts.hashAdminPassword("a-real-provisioned-password");
  withProductionAdminConfig(t, configuredHash);
  const state = { adminUsers: [{ id: "super_admin", username: "super_admin", passwordHash: accounts.hashAdminPassword("random-scrubbed-value"), status: "disabled", securityLockReason: "admin password provisioning required" }] };
  const [account] = accounts.ensureAdminUsers(state);
  assert.equal(account.status, "active");
  assert.equal(account.passwordHash, configuredHash);
  assert.equal(accounts.verifyAdminPassword("a-real-provisioned-password", account.passwordHash), true);
});

test("malformed administrator hashes fail closed without throwing", () => {
  for (const hash of ["", "broken", "scrypt:", "scrypt:bad:digest", "scrypt:0123456789abcdef0123456789abcdef:bad", "a".repeat(10000)]) {
    assert.doesNotThrow(() => accounts.verifyAdminPassword("password", hash));
    assert.equal(accounts.verifyAdminPassword("password", hash), false);
  }
});
