// Only GET requests. Never log response bodies or user records.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "artifacts");
const inventory = require("./artifacts/server-comparison-2026-10-13.json");
const base = "https://shop.taoguoguo.cc";
const checks = [];
const publicPaths = new Set(["/api/health", "/api/config", "/api/home", "/api/products", "/api/points-exchange", "/api/tasks", "/api/task-types", "/api/task-platform/status", "/api/pickup-sites", "/api/delivery/teams"]);
async function get(endpoint, expected, kind = "api") {
  try {
    const r = await fetch(base + endpoint, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    let data; try { data = JSON.parse(body); } catch { data = null; }
    const result = { endpoint, kind, expected, status: r.status, ok: r.status === expected, contentType: r.headers.get("content-type"), ...(Array.isArray(data) ? { count: data.length } : {}) };
    checks.push(result);
    return { data, body, result };
  } catch (e) {
    checks.push({ endpoint, kind, expected, ok: false, error: e.name });
    return {};
  }
}
async function main() {
  const paths = [...new Set(inventory.serverOperations.filter(o => o.method === "GET").map(o => o.path))];
  for (const endpoint of paths.filter(p => !p.includes("{"))) await get(endpoint, publicPaths.has(endpoint) ? 200 : 401);
  for (const endpoint of ["/api/admin/admin-users", "/api/admin/ranking", "/api/withdrawals/audit-nonexistent"]) await get(endpoint, 401);
  const { data: products } = await get("/api/products", 200);
  for (const product of products || []) await get("/api/products/" + encodeURIComponent(product.id), 200, "product-detail");
  await get("/api/products/audit-nonexistent", 404, "missing-product");
  // No authenticated order/payment GETs: some read handlers may reconcile state.
  for (const endpoint of paths.filter(p => p.includes("{") && !p.startsWith("/api/products/") && !p.startsWith("/api/tasks/"))) await get(endpoint.replace(/\{[^}]+\}/g, "audit-nonexistent"), 401, "anonymous-protection");
  const tasks = await get("/api/tasks?count=1&page=1", 200);
  const task = Array.isArray(tasks.data) ? tasks.data[0] : null;
  if (task?.id) await get("/api/tasks/" + encodeURIComponent(task.id), 200, "task-detail");
  for (const endpoint of ["/user", "/admin", "/admin/login", "/station", "/user/js/app.js", "/user/js/render.js", "/user/js/api.js", "/user/styles.css", "/admin/js/app.js", "/admin/js/render.js", "/admin/js/api.js", "/admin/styles.css", "/station/app.js", "/station/scanner.js", "/station/pickup-ui.js", "/station/styles.css"]) await get(endpoint, 200, "page-or-asset");
  const { data: home } = await get("/api/home", 200);
  const assets = new Set();
  function visit(value) {
    if (typeof value === "string" && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(value)) {
      try { const url = new URL(value, base); if (url.origin === base) assets.add(url.pathname + url.search); } catch {}
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  visit(home);
  for (const asset of assets) await get(asset, 200, "home-image");
  const result = { checkedAt: new Date().toISOString(), checks, total: checks.length, passed: checks.filter(c => c.ok).length, failed: checks.filter(c => !c.ok).length };
  fs.writeFileSync(path.join(root, "server-public-2026-10-13.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ total: result.total, passed: result.passed, failed: result.failed, failures: checks.filter(c => !c.ok), taskDetailChecked: checks.some(c => c.kind === "task-detail") }));
  if (result.failed) process.exitCode = 1;
}
main().catch(e => { console.error(e.name); process.exitCode = 1; });
