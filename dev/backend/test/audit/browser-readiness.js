// Reuse the existing CDP harness without registering its legacy scenarios.
// All browser mutations target a disposable local in-memory backend.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
for (const key of Object.keys(process.env)) {
  if (/^(TGG_|HF_|LFWIN_|XPYUN_|POSPAL_|WECHAT_)/.test(key) || key === "DATABASE_URL") delete process.env[key];
}
process.env.NODE_ENV = "test";
process.env.TGG_STORE_DRIVER = "json";
process.env.TGG_DEMO_PASSWORD = "123456";
const sourceFile = path.resolve(__dirname, "../e2e/frontend-cdp.test.js");
const harness = new Module(sourceFile, module);
harness.filename = sourceFile;
harness.paths = Module._nodeModulePaths(path.dirname(sourceFile));
const originalRequire = harness.require.bind(harness);
harness.require = name => name === "node:test" ? () => {} : originalRequire(name);
harness._compile(fs.readFileSync(sourceFile, "utf8") + "\nmodule.exports = { CDPPage, BASE, CDP_PORT, startServer, findChrome, waitForJson, stopProcess, runUserFlowPatrol };", sourceFile);
const { CDPPage, BASE, CDP_PORT, startServer, findChrome, waitForJson, stopProcess, runUserFlowPatrol } = harness.exports;

async function main() {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome/Edge unavailable");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-readiness-browser-"));
  const server = startServer();
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  const pages = [];
  const results = [];
  async function check(name, work) {
    try { results.push({ name, ok: true, detail: await work() }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
    console.log(JSON.stringify(results.at(-1)));
  }
  try {
    await waitForJson(`${BASE}/api/health`);
    await waitForJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const adminPage = await CDPPage.create(`${BASE}/admin/login`);
    pages.push(adminPage);
    await adminPage.waitForExpression("Boolean(document.querySelector('[data-admin-login]'))");
    await check("admin incorrect password stays on isolated login with visible error", async () => {
      await adminPage.fillFormAndSubmit("[data-admin-login]", { username: "super_admin", password: "incorrect-audit-password" });
      await adminPage.waitForText("账号或密码错误");
      assert.equal(await adminPage.evaluate("location.pathname === '/admin/login' && document.body.classList.contains('admin-login-mode')"), true);
    });
    await adminPage.fillFormAndSubmit("[data-admin-login]", { username: "super_admin", password: "123456" });
    await adminPage.waitForText("最近订单");
    const views = await adminPage.evaluate("Array.from(document.querySelectorAll('#adminNav [data-view]')).map(el => el.dataset.view)");
    for (const view of views) {
      await check(`admin view ${view}`, async () => {
        await adminPage.click(`[data-view="${view}"]`);
        await adminPage.waitForExpression(`document.querySelector('#adminNav [data-view="${view}"]').classList.contains('active') && !document.querySelector('#adminNav [data-view="${view}"]').disabled && document.querySelector('#adminScreen').innerText.trim().length > 0`);
        assert.deepEqual(adminPage.runtimeErrors(), []);
      });
    }
    const userPage = await CDPPage.create(`${BASE}/user`);
    pages.push(userPage);
    await userPage.waitForText("热门推荐");
    await check("member user patrol: address, task, invite, delivery order, refund, withdrawal, support", async () => {
      await runUserFlowPatrol(userPage);
      assert.deepEqual(userPage.runtimeErrors(), []);
    });
    await check("admin address list shows saved receiver, phone and address", async () => {
      await adminPage.goto(`${BASE}/admin`);
      await adminPage.waitForText("最近订单");
      await adminPage.click('[data-view="addressBook"]');
      await adminPage.waitForExpression("document.querySelector('#adminNav [data-view=addressBook]').classList.contains('active') && !document.querySelector('#adminNav [data-view=addressBook]').disabled");
      const body = await adminPage.evaluate("document.querySelector('#adminScreen').innerText");
      assert.ok(body.includes("测试收货人") && body.includes("13900001111") && body.includes("808"), "Saved address fields absent from admin table");
    });
    await check("user feedback text is displayed without executing HTML", async () => {
      await userPage.click('[data-tab="profile"]');
      await userPage.click('[data-page="feedback"]');
      await userPage.waitForExpression("Boolean(document.querySelector('[data-ticket-form]'))");
      await userPage.fillFormAndSubmit('[data-ticket-form]', {
        subject: "Audit markup", content: '<img src="/audit-nonexistent.png" onerror="window.__readinessMarkupExecuted=1">'
      });
      await userPage.waitForText("Audit markup");
      await userPage.waitForExpression("Boolean(document.querySelector('#screen img[src=\"/audit-nonexistent.png\"]')) || document.querySelector('#screen').innerText.includes('<img')");
      const executed = await userPage.evaluate("new Promise(resolve => setTimeout(() => resolve(window.__readinessMarkupExecuted === 1), 200))");
      assert.equal(executed, false, "Stored feedback HTML executed in the user page");
    });
    await check("expired admin session returns to isolated login", async () => {
      await adminPage.evaluate("localStorage.setItem('tggAdminToken', 'invalid-audit-token'); localStorage.removeItem('tggAdminRefreshToken')");
      await adminPage.goto(`${BASE}/admin`);
      await adminPage.waitForExpression("Boolean(document.querySelector('[data-admin-login]')) && document.body.classList.contains('admin-login-mode')");
      return await adminPage.evaluate("location.pathname");
    });
  } finally {
    for (const page of pages) page.close();
    await stopProcess(server);
    await stopProcess(chrome);
    // Leave the unique browser profile in the OS temp directory for inspection.
  }
  console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length }));
  if (results.some(r => !r.ok)) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
