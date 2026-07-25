const { createSeed } = require("./seed");
const { loadSQLiteState, saveSQLiteState } = require("./sqlite-store");
const fs = require("fs");
const path = require("path");

const STORE_FILE = process.env.TGG_STORE_FILE || path.resolve(__dirname, "..", "..", "data", "dev-store.json");
const STORE_DRIVER = process.env.TGG_STORE_DRIVER || "json";

let state = loadState();

function loadState() {
  if (process.env.TGG_STORE_MODE === "memory") return createSeed();
  if (STORE_DRIVER === "sqlite") return normalizeState(loadSQLiteState());

  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      const normalized = normalizeState(parsed);
      persist(normalized);
      return normalized;
    }
  } catch (error) {
    console.warn(`Failed to read store file, using seed data: ${error.message}`);
  }

  const seed = createSeed();
  persist(seed);
  return seed;
}

function getState() {
  return state;
}

function saveState() {
  if (process.env.TGG_STORE_MODE === "memory") return;
  if (STORE_DRIVER === "sqlite") {
    saveSQLiteState(state);
    return;
  }
  persist(state);
}

function resetState(nextState = createSeed()) {
  state = nextState;
  saveState();
  return state;
}

function persist(nextState) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const tempFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(nextState, null, 2), "utf8");
  fs.renameSync(tempFile, STORE_FILE);
}

function normalizeState(nextState) {
  const seed = createSeed();
  nextState.config = { ...seed.config, ...(nextState.config || {}) };
  nextState.roles = mergeRoles(nextState.roles || [], seed.roles);
  nextState.inviteRelations = nextState.inviteRelations || seed.inviteRelations;
  nextState.addresses = nextState.addresses || seed.addresses;
  nextState.signinSessions = nextState.signinSessions || seed.signinSessions;
  nextState.paymentLedger = nextState.paymentLedger || seed.paymentLedger;
  nextState.inventoryLedger = nextState.inventoryLedger || seed.inventoryLedger;
  nextState.withdrawableLedger = nextState.withdrawableLedger || seed.withdrawableLedger;
  nextState.withdrawRequests = nextState.withdrawRequests || seed.withdrawRequests;
  nextState.orderStatusLogs = nextState.orderStatusLogs || seed.orderStatusLogs;
  nextState.adminApprovalRequests = nextState.adminApprovalRequests || seed.adminApprovalRequests;
  nextState.adminOperationLogs = nextState.adminOperationLogs || seed.adminOperationLogs;
  nextState.operationTickets = nextState.operationTickets || seed.operationTickets;
  nextState.authSessions = nextState.authSessions || seed.authSessions;
  nextState.authLoginAttempts = nextState.authLoginAttempts || seed.authLoginAttempts;
  nextState.users = (nextState.users || seed.users).map((user) => ({ status: "active", ...user }));
  return nextState;
}

function mergeRoles(currentRoles, seedRoles) {
  const rolesById = new Map(currentRoles.map((role) => [role.id, { ...role, permissions: [...role.permissions] }]));
  for (const seedRole of seedRoles) {
    const current = rolesById.get(seedRole.id);
    if (!current) {
      rolesById.set(seedRole.id, { ...seedRole, permissions: [...seedRole.permissions] });
      continue;
    }
    current.name = current.name || seedRole.name;
    current.permissions = Array.from(new Set([...current.permissions, ...seedRole.permissions]));
  }
  return Array.from(rolesById.values());
}

function findCurrentUser(userId = state.currentUserId) {
  return state.users.find((user) => user.id === userId) || state.users.find((user) => user.id === state.currentUserId);
}

function findUser(userId) {
  return state.users.find((user) => user.id === userId);
}

function findProduct(productId) {
  return state.products.find((product) => product.id === productId && product.status === "on");
}

function nextId(prefix) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}_${Date.now()}_${suffix}`;
}

module.exports = {
  getState,
  saveState,
  resetState,
  findCurrentUser,
  findProduct,
  findUser,
  nextId
};
