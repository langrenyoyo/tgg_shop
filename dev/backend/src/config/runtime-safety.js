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
  const isolatedPgTest = env.NODE_ENV !== "production" && env.TGG_PG_MEM === "1";
  return env.NODE_ENV === "production"
    || (String(env.TGG_STORE_DRIVER || "json") === "pg" && !isolatedPgTest);
}

function cashPaymentsEnabled(env = process.env) {
  return String(env.TGG_DISABLE_CASH || "").trim() !== "1";
}

// Keep the old name readable during a rolling deployment while new config uses
// TGG_TASK_CALLBACK_TOKEN.
function taskCallbackToken(env = process.env) {
  return String(env.TGG_TASK_CALLBACK_TOKEN || env.TGG_TASK_CALLBACK_SECRET || "").trim();
}

function authSecret(env = process.env) {
  const configured = String(env.TGG_AUTH_SECRET || "").trim();
  return configured || (productionLike(env) ? "" : "tgg-shop-dev-auth-secret");
}

module.exports = {
  isIsolatedStore,
  mockOperationsEnabled,
  isolatedNonProduction,
  productionLike,
  cashPaymentsEnabled,
  taskCallbackToken,
  authSecret
};
