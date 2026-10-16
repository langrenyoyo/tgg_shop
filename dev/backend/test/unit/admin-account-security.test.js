const test = require("node:test");
const assert = require("node:assert/strict");
const accounts = require("../../src/domain/admin-accounts");
const auth = require("../../src/services/auth-service");
const { createSeed } = require("../../src/data/seed");

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

test("a production bootstrap hash never unlocks every seeded admin role", t => {
  const configuredHash = accounts.hashAdminPassword("bootstrap-only-password");
  withProductionAdminConfig(t, configuredHash);
  const state = {
    adminUsers: [
      { id: "super_admin", username: "super_admin", roleIds: ["super_admin"], passwordHash: accounts.hashAdminPassword("123456"), status: "active" },
      { id: "finance_admin", username: "finance_admin", roleIds: ["finance_admin"], passwordHash: accounts.hashAdminPassword("123456"), status: "active" },
      { id: "customer_service", username: "customer_service", roleIds: ["customer_service"], passwordHash: configuredHash, status: "active" }
    ]
  };
  const accountsAfterProvision = accounts.ensureAdminUsers(state);
  const bootstrap = accountsAfterProvision.find(item => item.id === "super_admin");
  const finance = accountsAfterProvision.find(item => item.id === "finance_admin");
  const customerService = accountsAfterProvision.find(item => item.id === "customer_service");
  assert.equal(bootstrap.status, "active");
  assert.equal(bootstrap.passwordHash, configuredHash);
  assert.equal(finance.status, "disabled");
  assert.equal(customerService.status, "disabled");
  assert.notEqual(finance.passwordHash, configuredHash);
  assert.notEqual(customerService.passwordHash, configuredHash);
  assert.equal(accounts.verifyAdminPassword("bootstrap-only-password", finance.passwordHash), false);
  assert.equal(accounts.verifyAdminPassword("bootstrap-only-password", customerService.passwordHash), false);
});

test("malformed administrator hashes fail closed without throwing", () => {
  for (const hash of ["", "broken", "scrypt:", "scrypt:bad:digest", "scrypt:0123456789abcdef0123456789abcdef:bad", "a".repeat(10000)]) {
    assert.doesNotThrow(() => accounts.verifyAdminPassword("password", hash));
    assert.equal(accounts.verifyAdminPassword("password", hash), false);
  }
});

test("PostgreSQL staging rejects fallback credentials and secrets", t => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    TGG_STORE_DRIVER: process.env.TGG_STORE_DRIVER,
    TGG_STORE_MODE: process.env.TGG_STORE_MODE,
    TGG_DEMO_PASSWORD: process.env.TGG_DEMO_PASSWORD,
    TGG_DEMO_PASSWORD_HASH: process.env.TGG_DEMO_PASSWORD_HASH,
    TGG_AUTH_SECRET: process.env.TGG_AUTH_SECRET
  };
  process.env.NODE_ENV = "staging";
  process.env.TGG_STORE_DRIVER = "pg";
  process.env.TGG_STORE_MODE = "memory";
  delete process.env.TGG_DEMO_PASSWORD;
  delete process.env.TGG_DEMO_PASSWORD_HASH;
  delete process.env.TGG_AUTH_SECRET;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const state = createSeed();
  const result = auth.login(state, { userId: state.users[0].id, password: "123456" });
  assert.deepEqual({ ok: result.ok, status: result.status }, { ok: false, status: 503 });
  assert.equal(state.authSessions?.length || 0, 0);
});
