const crypto = require("node:crypto");

function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

function verifyAdminPassword(password, hash) {
  if (typeof password !== "string" || password.length > 128) return false;
  try {
    let actual;
    let expected;
    if (hash?.startsWith("scrypt:")) {
      const parts = hash.split(":");
      if (parts.length !== 3 || !/^[a-f0-9]{32}$/i.test(parts[1]) || !/^[a-f0-9]{64}$/i.test(parts[2])) return false;
      actual = crypto.scryptSync(password, parts[1], 32);
      expected = Buffer.from(parts[2], "hex");
    } else {
      if (!/^[a-f0-9]{64}$/i.test(String(hash || ""))) return false;
      actual = crypto.scryptSync(password, process.env.TGG_PASSWORD_SALT || "tgg-shop-dev-password-salt", 32);
      expected = Buffer.from(hash, "hex");
    }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function configuredAdminPasswordHash() {
  return String(process.env.TGG_ADMIN_PASSWORD_HASH || process.env.TGG_DEMO_PASSWORD_HASH || "").trim();
}

const defaultPasswordHashCache = new Map();

function requiresProvisionedAdminCredentials() {
  const isolatedPgTest = process.env.NODE_ENV !== "production" && process.env.TGG_PG_MEM === "1";
  return process.env.NODE_ENV === "production"
    || (String(process.env.TGG_STORE_DRIVER || "json") === "pg" && !isolatedPgTest);
}

function isDefaultPasswordHash(hash) {
  if (!hash) return false;
  if (defaultPasswordHashCache.has(hash)) return defaultPasswordHashCache.get(hash);
  const result = verifyAdminPassword("123456", hash);
  defaultPasswordHashCache.set(hash, result);
  return result;
}

function ensureAdminUsers(state) {
  if (Array.isArray(state.adminUsers) && state.adminUsers.length) {
    const configuredHash = configuredAdminPasswordHash();
    const mustProvision = requiresProvisionedAdminCredentials();
    // The environment hash is a one-time bootstrap credential, not a shared
    // password for every seeded role. Keep exactly one explicit super-admin
    // eligible for bootstrap and quarantine all other seeded credentials.
    const bootstrapAccount = state.adminUsers.find(item =>
      item?.id === "super_admin"
      || item?.username === "super_admin"
      || item?.roleId === "super_admin"
      || (Array.isArray(item?.roleIds) && item.roleIds.includes("super_admin"))
    );
    const bootstrapId = bootstrapAccount?.id || null;
    state.adminUsers = state.adminUsers.map(item => {
      const normalized = {
      status: "active",
      roleIds: [],
      ...item,
      roleIds: Array.isArray(item.roleIds) ? item.roleIds : [item.roleId || item.id].filter(Boolean)
      };
      const isProvisioningLocked = normalized.securityLockReason === "admin password provisioning required";
      const isBootstrap = bootstrapId !== null && normalized.id === bootstrapId;
      const sharesBootstrapHash = configuredHash && normalized.passwordHash === configuredHash;
      if (configuredHash && isBootstrap && (isDefaultPasswordHash(normalized.passwordHash) || isProvisioningLocked || sharesBootstrapHash)) {
        normalized.passwordHash = configuredHash;
        normalized.status = "active";
        delete normalized.securityLockReason;
      } else if (configuredHash && !isBootstrap && (isDefaultPasswordHash(normalized.passwordHash) || isProvisioningLocked || sharesBootstrapHash)) {
        normalized.passwordHash = hashAdminPassword(crypto.randomBytes(32).toString("hex"));
        normalized.status = "disabled";
        normalized.securityLockReason = "individual admin password provisioning required";
      } else if (isDefaultPasswordHash(normalized.passwordHash) && mustProvision) {
        // Do not leave a known development password hash in a production store.
        normalized.passwordHash = hashAdminPassword(crypto.randomBytes(32).toString("hex"));
        normalized.status = "disabled";
        normalized.securityLockReason = "admin password provisioning required";
      }
      return normalized;
    });
    return state.adminUsers;
  }
  const { createSeed } = require("../data/seed");
  const configuredHash = configuredAdminPasswordHash();
  const configuredPassword = process.env.TGG_DEMO_PASSWORD || (!requiresProvisionedAdminCredentials() ? "123456" : "");
  const roles = createSeed().roles;
  const now = new Date().toISOString();
  state.adminUsers = roles.map(role => {
    const isBootstrap = role.id === "super_admin";
    const passwordHash = isBootstrap && configuredHash
      ? configuredHash
      : hashAdminPassword(configuredPassword || crypto.randomBytes(32).toString("hex"));
    const status = isBootstrap
      ? (requiresProvisionedAdminCredentials() && !configuredHash ? "disabled" : "active")
      : (requiresProvisionedAdminCredentials() ? "disabled" : "active");
    return {
      id: role.id, username: role.id, name: role.name, roleIds: [role.id], status,
      passwordHash, ...(status === "disabled" && requiresProvisionedAdminCredentials() ? { securityLockReason: "admin password provisioning required" } : {}),
      createdAt: now, updatedAt: now, lastLoginAt: ""
    };
  });
  return state.adminUsers;
}

function publicAdmin(account) {
  const { passwordHash, ...result } = account;
  return structuredClone(result);
}

function effectiveRole(state, account) {
  const roles = state.roles.filter(role => account.roleIds.includes(role.id));
  return { id: roles.length === 1 ? roles[0].id : account.id, name: account.name,
    roleIds: roles.map(role => role.id), permissions: [...new Set(roles.flatMap(role => role.permissions))] };
}

module.exports = { hashAdminPassword, verifyAdminPassword, ensureAdminUsers, publicAdmin, effectiveRole, configuredAdminPasswordHash };
