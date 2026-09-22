const http = require("http");

require("./src/config/env-file").loadEnv();

// Validate before importing services that initialize storage or provider clients.
const { validateRuntimeConfig } = require("./src/config/runtime-config");
const runtimeConfig = validateRuntimeConfig();
if (!runtimeConfig.ok) throw new Error(runtimeConfig.errors.join("; "));
for (const warning of runtimeConfig.warnings) console.warn(warning);

const { send } = require("./src/http/http-utils");
const { routeStatic } = require("./src/http/static-router");
const { routeApi } = require("./src/routes/api-router");
const { whenReady, getStoreDriver, isPgReady, shutdownStore, getState } = require("./src/data/store");
const { settleMonthlyPointRewards } = require("./src/services/monthly-point-reward-service");
const { withPersistence } = require("./src/data/persistence-scope");
const { createTaskSweep } = require("./src/services/task-sweep-service");

const PORT = Number(process.env.PORT || 5177);
let rewardSweepTimer = null;
let taskSweepTimer = null;
const taskSweep = createTaskSweep();

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
    if (url.pathname.startsWith("/api/")) return await routeApi(req, res, url);

    const staticHandled = routeStatic(req, res, url);
    if (staticHandled !== false) return staticHandled;

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    const status = Number(error?.status || error?.statusCode);
    const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    const safeMessage = safeStatus === 500 ? "服务器暂时无法处理请求" : String(error?.message || "请求处理失败");
    return send(res, safeStatus, { error: safeMessage });
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
    console.log(`Station app: http://localhost:${PORT}/station`);
    runTaskSweep();
  });
  taskSweepTimer = setInterval(runTaskSweep, 15 * 60 * 1000);
}

start().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  if (rewardSweepTimer) clearInterval(rewardSweepTimer);
  if (taskSweepTimer) clearInterval(taskSweepTimer);
  await taskSweep.stop().catch(() => {});
  await shutdownStore().catch(() => {});
  server.close(() => process.exit(0));
}

function runTaskSweep() {
  if (process.env.TGG_TASK_SWEEP_ENABLED === "0") return;
  taskSweep.run().then(result => {
    if (result.checked) console.log(`Task sweep: checked=${result.checked}, reconciled=${result.reconciled}, deferred=${result.deferred}`);
  }).catch(() => console.error("Task sweep failed; remaining submissions will be retried on the next interval"));
}

async function sweepMonthlyRewards(source) {
  const result = await withPersistence(() => settleMonthlyPointRewards(getState(), {
    now: new Date(),
    reason: `monthly reward sweep:${source}`,
    actor: { id: "system", role: { id: "system" } }
  }));
  if (result.appliedCount > 0) {
    console.log(`Monthly reward sweep applied ${result.appliedCount} grants`);
  }
  return result;
}
