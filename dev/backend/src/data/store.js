const fs = require("fs");
const path = require("path");
const { trackSave } = require("./persistence-scope");
const { createSeed } = require("./seed");
const { normalizeState } = require("./state-normalizer");
const { loadSQLiteState, saveSQLiteState } = require("./sqlite-store");
const { initPgState, savePgState, flushPgState, closePgPool, isPgReady, hasPgWriteConflict } = require("./pg-store");

const STORE_FILE = process.env.TGG_STORE_FILE || path.resolve(__dirname, "..", "..", "data", "dev-store.json");
const STORE_DRIVER = process.env.TGG_STORE_DRIVER || "json";

let state = createSeed();
let readyPromise = null;
let persistQueue = Promise.resolve();

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

  // Never replace an existing unreadable/corrupt business store with seed data.
  // Fail startup so the original file remains available for recovery.
  if (fs.existsSync(STORE_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    state = normalizeState(parsed);
    readyPromise = Promise.resolve(state);
    return state;
  }

  state = normalizeState(createSeed());
  persist(state);
  readyPromise = Promise.resolve(state);
  return state;
}

function getState() {
  if (STORE_DRIVER === "pg" && hasPgWriteConflict()) {
    const error = new Error("数据已被其他实例更新，请暂停当前实例并核对后重新加载");
    error.code = "STATE_WRITE_CONFLICT";
    throw error;
  }
  return state;
}

function getStoreDriver() {
  return STORE_DRIVER;
}

function whenReady() {
  return readyPromise || Promise.resolve(state);
}

function saveState() {
  return trackSave(persistState());
}

async function persistState() {
  if (process.env.TGG_STORE_MODE === "memory") return state;
  if (STORE_DRIVER === "pg") {
    await savePgState(state);
    return state;
  }
  if (STORE_DRIVER === "sqlite") {
    saveSQLiteState(state);
    return state;
  }
  // A failed write must reject its caller without poisoning later retries.
  const payload = JSON.stringify(state, null, 2);
  persistQueue = persistQueue.catch(() => {}).then(() => { persistPayload(payload); });
  await persistQueue;
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
  persistPayload(JSON.stringify(nextState, null, 2));
}

function persistPayload(payload) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const tempFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tempFile, payload, "utf8");
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
