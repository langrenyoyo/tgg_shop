// Live-site navigation audit. Browser requests are restricted to same-origin
// reads and admin authentication; no business forms or action buttons are used.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const sourceFile = path.resolve(__dirname, "../e2e/frontend-cdp.test.js");
const harness = new Module(sourceFile, module);
harness.filename = sourceFile;
harness.paths = Module._nodeModulePaths(path.dirname(sourceFile));
const originalRequire = harness.require.bind(harness);
harness.require = name => name === "node:test" ? () => {} : originalRequire(name);
harness._compile(fs.readFileSync(sourceFile, "utf8") + "\nmodule.exports = { CDPPage, CDP_PORT, findChrome, waitForJson, stopProcess };", sourceFile);
const { CDPPage, CDP_PORT, findChrome, waitForJson, stopProcess } = harness.exports;
const BASE = "https://shop.taoguoguo.cc";
async function main() {
  const username = process.env.TGG_AUDIT_ADMIN_USERNAME;
  const password = process.env.TGG_AUDIT_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("Set TGG_AUDIT_ADMIN_USERNAME and TGG_AUDIT_ADMIN_PASSWORD before running the live audit");
  const executable = findChrome();
  if (!executable) throw new Error("Browser unavailable");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-server-browser-"));
  const chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let page;
  let logoutToken;
  const results = [], blocked = [], failures = [];
  const check = async (name, work) => {
    try { results.push({ name, ok: true, detail: await work() }); }
    catch (error) { results.push({ name, ok: false, error: error.message.split("\n")[0] }); }
    console.log(JSON.stringify(results.at(-1)));
  };
  try {
    await waitForJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    page = await CDPPage.create("about:blank");
    page.ws.addEventListener("message", async event => {
      const message = JSON.parse(event.data);
      if (message.method === "Network.responseReceived") {
        const r = message.params.response;
        if (r.status >= 400) failures.push({ path: new URL(r.url).pathname, status: r.status });
      }
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const allowed = url.origin === BASE && (request.method === "GET" || (request.method === "POST" && ["/api/admin/auth/login", "/api/admin/auth/logout"].includes(url.pathname)));
      if (!allowed) blocked.push({ path: url.pathname, method: request.method });
      await page.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId } : { requestId, errorReason: "BlockedByClient" }).catch(() => {});
    });
    await page.send("Network.enable");
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "http*", requestStage: "Request" }] });
    await page.goto(BASE + "/admin/login");
    await page.waitForExpression("Boolean(document.querySelector('[data-admin-login]'))");
    for (const viewport of [{ width: 1440, height: 900, mobile: false }, { width: 390, height: 844, mobile: true }]) {
      await check(`login layout ${viewport.width}`, async () => {
        await page.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
        const result = await page.evaluate("({ isolated: document.body.classList.contains('admin-login-mode'), overflow:document.documentElement.scrollWidth>innerWidth, navVisible:!!document.querySelector('#adminNav')?.getClientRects().length })");
        assert.equal(result.isolated, true); assert.equal(result.overflow, false); assert.equal(result.navVisible, false);
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        const file = path.join(profile, `login-${viewport.width}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
        return { ...result, screenshot: file };
      });
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, mobile: false, deviceScaleFactor: 1 });
    await check("unknown account displays inline error", async () => {
      await page.fillFormAndSubmit("[data-admin-login]", { username: "audit-nonexistent-20261013", password: "invalid-audit" });
      await page.waitForExpression("Boolean(document.querySelector('[data-admin-login]')) && document.body.innerText.includes('账号或密码错误')");
      assert.equal(await page.evaluate("location.pathname"), "/admin/login");
    });
    await page.fillFormAndSubmit("[data-admin-login]", { username, password });
    await page.waitForExpression("!document.body.classList.contains('admin-login-mode') && !document.querySelector('#adminNav [data-view=dashboard]').disabled");
    logoutToken = await page.evaluate("localStorage.getItem('tggAdminToken')");
    const views = await page.evaluate("Array.from(document.querySelectorAll('#adminNav [data-view]')).map(e=>e.dataset.view)");
    for (const view of views) {
      await check(`admin ${view}`, async () => {
        await page.click(`[data-view="${view}"]`);
        await page.waitForExpression(`document.querySelector('#adminNav [data-view="${view}"]').classList.contains('active') && !document.querySelector('#adminNav [data-view="${view}"]').disabled && document.querySelector('#adminScreen').innerText.trim().length>0`);
        assert.deepEqual(page.runtimeErrors(), []);
        return await page.evaluate("({rows:document.querySelectorAll('#adminScreen tbody tr').length,overflow:document.documentElement.scrollWidth>innerWidth})");
      });
    }
    await check("logout revokes session and protected navigation returns to login", async () => {
      const status = await page.evaluate("fetch('/api/admin/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('tggAdminToken'),'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)");
      assert.equal(status, 200);
      await page.evaluate("localStorage.removeItem('tggAdminRefreshToken')");
      await page.goto(BASE + "/admin");
      await page.waitForExpression("location.pathname==='/admin/login' && document.body.classList.contains('admin-login-mode') && Boolean(document.querySelector('[data-admin-login]'))");
    });
  } finally {
    if (logoutToken) await fetch(BASE + "/api/admin/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${logoutToken}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000) }).catch(() => {});
    page?.close();
    await stopProcess(chrome);
  }
  console.log(JSON.stringify({ total: results.length, passed: results.filter(r=>r.ok).length, failed: results.filter(r=>!r.ok).length, blocked, httpFailures: failures }));
  if (results.some(r=>!r.ok)) process.exitCode=1;
}
main().catch(error=>{ console.error(error.message.split("\n")[0]);process.exitCode=1; });
