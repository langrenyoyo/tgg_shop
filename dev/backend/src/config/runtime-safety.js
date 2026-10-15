function isIsolatedStore(env = process.env) {
  return env.TGG_STORE_MODE === "memory"
    || env.TGG_PG_MEM === "1"
    || String(env.TGG_STORE_DRIVER || "json") !== "pg";
}

function mockOperationsEnabled(env = process.env) {
  return env.NODE_ENV !== "production"
    && isIsolatedStore(env)
    && String(env.TGG_TEST_BYPASS_ENABLED || "") === "1";
}

function isolatedNonProduction(env = process.env) {
  return env.NODE_ENV !== "production" && isIsolatedStore(env);
}

function productionLike(env = process.env) {
  return env.NODE_ENV === "production" || String(env.TGG_STORE_DRIVER || "json") === "pg";
}

module.exports = {
  isIsolatedStore,
  mockOperationsEnabled,
  isolatedNonProduction,
  productionLike
};
