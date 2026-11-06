const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const adminDir = path.resolve(__dirname, "../../../frontend/admin/js");

function context(extra = {}) {
  const ctx = vm.createContext(extra);
  const source = fs.readFileSync(path.join(adminDir, "global-search.js"), "utf8").replace(/export /g, "");
  vm.runInContext(`(function () { ${source}\n Object.assign(globalThis, { createAdminSearch, renderGlobalSearch, renderSearchTarget, searchRecords }); })()`, ctx);
  return ctx;
}
const identity = () => ({ adminId: "admin_1", permissions: ["*"] });
const response = id => ({ query: id, total: 1, limit: 20, groups: [{ type: "orders", label: "订单", total: 1, items: [{ id, title: id, description: "鲜苹果", status: "paid" }] }] });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("search calls the authenticated API with an encoded trimmed query and surfaces failures without stale results", async () => {
  const ctx = context();
  const state = { identity: identity(), view: "dashboard" };
  const paths = [];
  const controller = ctx.createAdminSearch(state, { api: async url => { paths.push(url); throw new Error("服务暂不可用"); }, render: () => {}, reload: async () => {} });
  await controller.submit("  苹果 & 订单  ");
  assert.equal(paths[0], `/api/admin/search?q=${encodeURIComponent("苹果 & 订单")}`);
  assert.equal(state.view, "search");
  assert.equal(state.globalSearch.status, "error");
  assert.equal(state.globalSearch.error, "服务暂不可用");
  assert.equal(state.globalSearch.groups.length, 0);
  await controller.submit("   ");
  assert.equal(paths.length, 1);
  assert.match(state.globalSearch.error, /关键词/);
});

test("a slower previous search cannot replace the latest result", async () => {
  const ctx = context();
  const state = { identity: identity(), view: "dashboard" };
  const first = deferred(), second = deferred();
  const controller = ctx.createAdminSearch(state, { api: url => url.endsWith("first") ? first.promise : second.promise, render: () => {}, reload: async () => {} });
  const a = controller.submit("first"), b = controller.submit("second");
  second.resolve(response("second")); await b;
  first.resolve(response("first")); await a;
  assert.equal(state.globalSearch.query, "second");
  assert.equal(state.globalSearch.groups[0].items[0].id, "second");
});

test("clearing search or losing the session prevents a pending response from restoring results", async () => {
  for (const action of ["reset", "invalidate"]) {
    const ctx = context();
    const state = { identity: identity(), view: "users" };
    const pending = deferred();
    const controller = ctx.createAdminSearch(state, { api: () => pending.promise, render: () => {}, reload: async () => {} });
    const request = controller.submit("first");
    controller[action]();
    if (action === "invalidate") state.identity = null;
    pending.resolve(response("first")); await request;
    assert.equal(state.globalSearch, null);
    if (action === "reset") assert.equal(state.view, "users");
  }
});

test("search completion preserves subsequent navigation and results only open permitted matching records", async () => {
  const ctx = context();
  const state = { identity: identity(), view: "dashboard", productStatus: "off", productSearch: "old", editingProductId: "other" };
  const pending = deferred(); let reloads = 0;
  const controller = ctx.createAdminSearch(state, { api: () => pending.promise, render: () => {}, reload: async () => { reloads++; } });
  const request = controller.submit("apple");
  state.view = "users";
  pending.resolve({ groups: [{ type: "products", items: [{ id: "p_1" }] }] }); await request;
  assert.equal(state.view, "users");
  await controller.open("products", "missing");
  assert.equal(reloads, 0);
  state.identity.permissions = ["order:read"];
  await controller.open("products", "p_1");
  assert.equal(reloads, 0);
  state.identity.permissions = ["product:read"];
  await controller.open("products", "p_1");
  assert.equal(reloads, 1);
  assert.equal(state.view, "products");
  assert.equal(state.searchTarget.id, "p_1");
  assert.equal(state.productStatus, "");
  assert.equal(state.productSearch, "");
  assert.equal(state.editingProductId, null);
  assert.deepEqual(Array.from(ctx.searchRecords(state, "products", [{ id: "p_2" }, { id: "p_1" }]), item => item.id), ["p_1"]);
  controller.back();
  assert.equal(state.view, "search");
  assert.equal(state.searchTarget, null);
});

function renderContext() {
  const elements = Object.fromEntries(["#adminIdentity", "#adminLogout", "#adminTitle", "#adminSubtitle", "#adminScreen"].map(selector => [selector, {}]));
  const ctx = context({
    document: { body: { classList: { toggle() {} } }, querySelector: selector => elements[selector], querySelectorAll: () => [] },
    pendingApprovalIntents: () => [], productEditor: () => ""
  });
  const source = fs.readFileSync(path.join(adminDir, "render.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  vm.runInContext(source + "\nglobalThis.render = renderAdminPage;", ctx);
  return { ctx, html: () => elements["#adminScreen"].innerHTML };
}

test("search renders grouped links, truncation hints, empty/error states and escapes malicious query/result text", () => {
  const { ctx, html } = renderContext();
  const state = { view: "search", identity: identity(), globalSearch: { ...response("<img src=x onerror=alert(1)>"), status: "ready" } };
  state.globalSearch.groups[0].total = 25;
  ctx.render(state);
  assert.match(html(), /data-admin-search-open="&lt;img/);
  assert.match(html(), /仅展示前 1 条，共 25 条/);
  assert.doesNotMatch(html(), /<img/);
  state.globalSearch = { status: "ready", query: "missing", groups: [{ type: "orders", label: "订单", total: 0, items: [] }] };
  ctx.render(state);
  assert.match(html(), /未找到匹配记录/);
  state.globalSearch = { status: "error", error: "网络失败" };
  ctx.render(state);
  assert.match(html(), /role="alert">网络失败/);
  assert.match(html(), /data-admin-search-retry/);
  state.globalSearch = { status: "loading" };
  ctx.render(state);
  assert.match(html(), /正在搜索/);
});

test("record links locate an exact order/user/product on its management page and report missing records", () => {
  const { ctx, html } = renderContext();
  for (const view of ["orders", "users", "products"]) {
    const state = { identity: identity(), view, searchTarget: { view, id: "target_id" }, [view]: [
      { id: "target_id", name: "target", nickname: "target", items: [] },
      { id: "other_id", name: "other", nickname: "other", items: [] }
    ] };
    ctx.render(state);
    assert.match(html(), /target_id/);
    assert.doesNotMatch(html(), /other_id/);
    assert.match(html(), /data-admin-search-back/);
    state[view] = [];
    ctx.render(state);
    assert.match(html(), /记录已不存在或暂时无法读取/);
    state.searchTarget = null;
    state[view] = [{ id: "other_id" }];
    ctx.render(state);
    assert.match(html(), /other_id/);
  }
});

test("the header form submit event reaches the search API and the clear button restores the dashboard", async () => {
  const bodyEvents = {}, elementEvents = {}, calls = [];
  const ctx = context({
    document: {
      body: { addEventListener: (name, handler) => { (bodyEvents[name] ||= []).push(handler); } },
      querySelector: selector => ({ value: "", addEventListener: (name, handler) => { elementEvents[`${selector}:${name}`] = handler; } })
    },
    window: { location: { replace() {} }, addEventListener() {}, setInterval() {} },
    getAdminRole: () => "super_admin", hasAdminSession: () => false, isAdminLoginPage: () => false,
    ADMIN_LOGIN_PATH: "/admin/login", renderAdminPage() {}, printingClick: () => false, stationAccountClick: () => false,
    FormData: class { get() { return "test & query"; } },
    api: async url => { calls.push(url); return response("order_1"); }
  });
  const source = fs.readFileSync(path.join(adminDir, "app.js"), "utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInContext(source, ctx);
  vm.runInContext('state.identity = { adminId: "admin_1", permissions: ["*"] }; state.loading = false;', ctx);
  let prevented = false;
  const form = {};
  for (const handler of bodyEvents.submit) handler({ target: { closest: selector => selector === "[data-admin-search]" ? form : null }, preventDefault: () => { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(calls[0], `/api/admin/search?q=${encodeURIComponent("test & query")}`);
  assert.equal(vm.runInContext("state.view", ctx), "search");
  for (const handler of bodyEvents.click) handler({ target: { closest: selector => selector === "[data-admin-search-clear]" ? {} : null } });
  assert.equal(vm.runInContext("state.view", ctx), "dashboard");
  assert.equal(vm.runInContext("state.globalSearch", ctx), null);
});
