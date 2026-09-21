const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../../frontend/admin/js/api.js"), "utf8").replace(/export /g, "");

test("admin approval retry after reload keeps exact intent and key until a definitive result", async () => {
  const storage = new Map([["tggAdminToken", "token"], ["tggAdminRole", "finance"]]);
  const requests = []; let result = "lost", sequence = 0;
  const localStorage = { get length() { return storage.size; }, key: index => [...storage.keys()][index], getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  function load() {
    const context = { localStorage, crypto: { randomUUID: () => `key-${++sequence}` }, fetch: async (url, options) => {
      requests.push(JSON.parse(options.body));
      if (result === "lost") throw new Error("response lost");
      return { ok: result === 201, status: result, json: async () => ({ id: "approval", error: "conflict" }) };
    } };
    vm.createContext(context); vm.runInContext(source + "\nglobalThis.callApi = Object.assign(api, { pendingApprovalIntents, retryApprovalIntent });", context); return context.callApi;
  }
  const payload = { action: "points.adjust", targetType: "user", targetId: "alice", payload: { pointsDelta: 10 }, reason: "核对" };
  const send = (api, body = payload) => api("/api/admin/approval-requests", { method: "POST", body: JSON.stringify(body) });
  await assert.rejects(send(load()), /response lost/);
  const reloaded = load();
  assert.equal(reloaded.pendingApprovalIntents().length, 1);
  const pendingId = reloaded.pendingApprovalIntents()[0].id;
  storage.set("tggAdminRole", "other");
  assert.equal(reloaded.pendingApprovalIntents().length, 0);
  await assert.rejects(reloaded.retryApprovalIntent(pendingId), /切换角色/);
  storage.set("tggAdminRole", "finance");
  await assert.rejects(send(reloaded, { ...payload, payload: { pointsDelta: 20 } }), /原金额/);
  assert.equal(requests.length, 1);
  result = 201; await reloaded.retryApprovalIntent(pendingId);
  assert.equal(reloaded.pendingApprovalIntents().length, 0);
  assert.deepEqual(requests[0], requests[1]);
  await send(reloaded); assert.notEqual(requests[2].idempotencyKey, requests[1].idempotencyKey);
  result = 409; await assert.rejects(send(reloaded));
  result = 201; await send(reloaded, { ...payload, payload: { pointsDelta: 20 } });
});

test("pending approval panel shows escaped original intent only to roles allowed to request approval", () => {
  const renderSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/admin/js/render.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  let panel = "";
  const element = { textContent: "", innerHTML: "", insertAdjacentHTML: (_, value) => { panel += value; } };
  const context = {
    document: { querySelector: () => element, querySelectorAll: () => [] },
    pendingApprovalIntents: () => [{ id: 'key"', payload: { action: "points.adjust", targetId: "<target>", reason: "<script>bad</script>", payload: { pointsDelta: 10 } } }]
  };
  vm.createContext(context); vm.runInContext(renderSource + "\nglobalThis.render = renderAdminPage;", context);
  context.render({ view: "ledger", identity: { permissions: ["approval:request"] } });
  assert.match(panel, /重试原申请/); assert.match(panel, /&lt;target&gt;/); assert.match(panel, /&lt;script&gt;/);
  assert.doesNotMatch(panel, /<script>/);
  panel = "";
  context.render({ view: "ledger", identity: { permissions: ["order:read"] } });
  assert.equal(panel, "");
});
