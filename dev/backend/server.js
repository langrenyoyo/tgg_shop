const http = require("http");
const fs = require("fs");
const path = require("path");
const { send } = require("./src/http/http-utils");
const { routeStatic } = require("./src/http/static-router");
const { routeApi } = require("./src/routes/api-router");
const { whenReady, getStoreDriver, isPgReady, shutdownStore, getState } = require("./src/data/store");
const { validateRuntimeConfig } = require("./src/config/runtime-config");
const { settleMonthlyPointRewards } = require("./src/services/monthly-point-reward-service");

function loadDotEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const runtimeConfig = validateRuntimeConfig(process.env, process.env.NODE_ENV === "production");
if (!runtimeConfig.ok) {
  throw new Error(runtimeConfig.errors.join("; "));
}
for (const warning of runtimeConfig.warnings) {
  console.warn(warning);
}

const PORT = Number(process.env.PORT || 5177);
let rewardSweepTimer = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/health") {
      return send(res, 200, {
        ok: true,
        service: "tgg-shop-dev",
        driver: getStoreDriver(),
        storeReady: getStoreDriver() !== "pg" ? true : isPgReady(),
        pgReady: getStoreDriver() !== "pg" ? null : isPgReady()
      });
    }
    if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);

    const staticHandled = routeStatic(req, res, url);
    if (staticHandled !== false) return staticHandled;

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

async function start() {
  await whenReady();
  await sweepMonthlyRewards("startup");
  rewardSweepTimer = setInterval(() => {
    sweepMonthlyRewards("interval").catch((error) => {
      console.error(error.stack || error.message);
    });
  }, 15 * 60 * 1000);
  server.listen(PORT, () => {
    console.log(`TGG Shop dev server: http://localhost:${PORT}`);
    console.log(`User app: http://localhost:${PORT}/user`);
    console.log(`Admin app: http://localhost:${PORT}/admin`);
  });
}

start().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  if (rewardSweepTimer) clearInterval(rewardSweepTimer);
  await shutdownStore().catch(() => {});
  server.close(() => process.exit(0));
}

async function sweepMonthlyRewards(source) {
  const result = settleMonthlyPointRewards(getState(), {
    now: new Date(),
    reason: `monthly reward sweep:${source}`,
    actor: { id: "system", role: { id: "system" } }
  });
  if (result.appliedCount > 0) {
    console.log(`Monthly reward sweep applied ${result.appliedCount} grants`);
  }
  return result;
}
