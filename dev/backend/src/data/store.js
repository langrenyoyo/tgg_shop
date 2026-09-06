const fs = require("fs");
const path = require("path");
const { createSeed } = require("./seed");
const { normalizeState } = require("./state-normalizer");
const { loadSQLiteState, saveSQLiteState } = require("./sqlite-store");
const { initPgState, savePgState, flushPgState, closePgPool, isPgReady } = require("./pg-store");

const STORE_FILE = process.env.TGG_STORE_FILE || path.resolve(__dirname, "..", "..", "data", "dev-store.json");
const STORE_DRIVER = process.env.TGG_STORE_DRIVER || "json";

let state = createSeed();
let readyPromise = null;

function loadState() {
  if (process.env.TGG_STORE_MODE === "memory") {
    state = createSeed();
    readyPromise = Promise.resolve(state);
    return state;
  }

  if (STORE_DRIVER === "pg") {
    readyPromise = initPgState().then((loaded) => {
      state = normalizeState(loaded);
      return state;
    });
    return state;
  }

  if (STORE_DRIVER === "sqlite") {
    state = normalizeState(loadSQLiteState());
    readyPromise = Promise.resolve(state);
    return state;
  }

  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      state = normalizeState(parsed);
      persist(state);
      readyPromise = Promise.resolve(state);
      return state;
    }
  } catch (error) {
    console.warn(`Failed to read store file, using seed data: ${error.message}`);
  }

  state = normalizeState(createSeed());
  persist(state);
  readyPromise = Promise.resolve(state);
  return state;
}

function getState() {
  return state;
}

function getStoreDriver() {
  return STORE_DRIVER;
}

function whenReady() {
  return readyPromise || Promise.resolve(state);
}

async function saveState() {
  if (process.env.TGG_STORE_MODE === "memory") return state;
  if (STORE_DRIVER === "pg") {
    await savePgState(state);
    return state;
  }
  if (STORE_DRIVER === "sqlite") {
    saveSQLiteState(state);
    return state;
  }
  persist(state);
  return state;
}

function resetState(nextState = createSeed()) {
  state = normalizeState(nextState);
  readyPromise = Promise.resolve(state);
  if (STORE_DRIVER === "pg") {
    readyPromise = savePgState(state).then(() => state);
  } else if (STORE_DRIVER === "sqlite") {
    saveSQLiteState(state);
  } else if (process.env.TGG_STORE_MODE !== "memory") {
    persist(state);
  }
  return state;
}

function persist(nextState) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const tempFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(nextState, null, 2), "utf8");
  fs.renameSync(tempFile, STORE_FILE);
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

async function shutdownStore() {
  if (STORE_DRIVER === "pg") {
    await flushPgState().catch(() => {});
    await closePgPool();
  }
}

loadState();

module.exports = {
  getState,
  getStoreDriver,
  whenReady,
  saveState,
  resetState,
  findCurrentUser,
  findProduct,
  findUser,
  nextId,
  isPgReady,
  shutdownStore
};
