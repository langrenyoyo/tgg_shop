const crypto = require("node:crypto");

function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

function verifyAdminPassword(password, hash) {
  if (typeof password !== "string" || password.length > 128) return false;
  let actual;
  let expected;
  if (hash?.startsWith("scrypt:")) {
    const [, salt, digest] = hash.split(":");
    actual = crypto.scryptSync(password, salt, 32);
    expected = Buffer.from(digest || "", "hex");
  } else {
    actual = crypto.scryptSync(password, process.env.TGG_PASSWORD_SALT || "tgg-shop-dev-password-salt", 32);
    expected = Buffer.from(hash || "", "hex");
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function ensureAdminUsers(state) {
  if (Array.isArray(state.adminUsers)) return state.adminUsers;
  const { createSeed } = require("../data/seed");
  const passwordHash = process.env.TGG_DEMO_PASSWORD_HASH || hashAdminPassword(process.env.TGG_DEMO_PASSWORD || "123456");
  state.adminUsers = createSeed().roles.map(role => ({
    id: role.id, username: role.id, name: role.name, roleIds: [role.id], status: "active",
    passwordHash, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLoginAt: ""
  }));
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

module.exports = { hashAdminPassword, verifyAdminPassword, ensureAdminUsers, publicAdmin, effectiveRole };
