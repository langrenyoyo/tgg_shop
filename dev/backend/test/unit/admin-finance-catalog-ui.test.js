const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const dir = path.resolve(__dirname, "../../../frontend/admin/js");
function load(file, extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(fs.readFileSync(path.join(dir, file), "utf8").replace(/export /g, ""), ctx);
  return ctx;
}
function fixture(filters = {}) {
  return {
    financeFilters: filters, identity: { permissions: ["*"] },
    users: [{ id: "u1", nickname: "小鹿Alice", phone: "13800000000" }, { id: "u2", nickname: "Bob" }],
    orders: [{ id: "o1", orderNo: "TGG123" }],
    refunds: [{ id: "rf1", orderId: "o1", userId: "u1", status: "pending_review" }, { id: "rf2", orderId: "o2", userId: "u2", status: "refunded" }],
    withdrawals: [{ id: "wd1", userId: "u1", status: "pending_review" }, { id: "wd2", userId: "u2", status: "paid" }],
    approvalRequests: [
      { id: "ap1", action: "refund.approve", targetType: "refund", targetId: "rf1", status: "pending" },
      { id: "ap2", action: "withdrawal.approve", targetType: "withdrawal", targetId: "wd1", status: "pending" },
      { id: "ap3", action: "points.adjust", targetType: "user", targetId: "u2", status: "executed" },
      { id: "ap4", action: "withdrawal.reject", targetType: "withdrawal", targetId: "wd1", status: "rejected" },
      { id: "ap5", action: "monthly_reward.reverse", targetType: "monthly_reward", targetId: "m1", status: "pending", payload: { targetSnapshot: { userId: "u1" } } }
    ]
  };
}
const ids = rows => Array.from(rows, item => item.id);

test("finance query combines order, user, refund, approval, action and status across linked records", () => {
  const { filterFinance } = load("finance-filters.js");
  const filtered = filterFinance(fixture({ orderId: "tgg123", user: " alice ", refundId: "rf1", approvalId: "ap1", action: "refund.approve", status: "pending" }));
  assert.deepEqual(ids(filtered.approvalRequests), ["ap1"]);
  assert.equal(filtered.refunds.length, 0); // The business row has a different status.
  assert.equal(filtered.withdrawals.length, 0);
  for (const user of ["U1", "小鹿", "138000"]) {
    assert.deepEqual(ids(filterFinance(fixture({ user })).approvalRequests), ["ap1", "ap2", "ap4", "ap5"]);
  }
});

test("withdrawal and approval filters link correctly and do not mix different approval actions", () => {
  const { filterFinance } = load("finance-filters.js");
  const rows = filterFinance(fixture({ withdrawalId: "wd1", approvalId: "ap2", action: "withdrawal.approve" }));
  assert.deepEqual(ids(rows.withdrawals), ["wd1"]);
  assert.deepEqual(ids(rows.approvalRequests), ["ap2"]);
  assert.equal(rows.refunds.length, 0);
  assert.equal(filterFinance(fixture({ approvalId: "ap2", action: "withdrawal.reject" })).withdrawals.length, 0);
  assert.equal(filterFinance(fixture({ orderId: "no-match" })).approvalRequests.length, 0);
  assert.deepEqual(ids(filterFinance(fixture()).approvalRequests), ["ap1", "ap2", "ap3", "ap4", "ap5"]);
});

test("finance renders one active table, tab counts, retained queries and escaped input", () => {
  const elements = { "#adminIdentity": {}, "#adminLogout": {}, "#adminTitle": {}, "#adminSubtitle": {}, "#adminScreen": {} };
  const ctx = load("finance-filters.js", {
    pendingApprovalIntents: () => [], renderSearchTarget: () => "", renderDashboard: () => "", productEditor: () => "", adminAccountsView: () => "", stationAccountsView: () => "", printingView: () => "", signinSettings: () => "", renderGlobalSearch: () => "",
    document: { body: { classList: { toggle() {} } }, querySelector: key => elements[key], querySelectorAll: () => [] }
  });
  vm.runInContext(fs.readFileSync(path.join(dir, "render.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, ""), ctx);
  for (const [tab, title] of [["refunds", "退款审批"], ["withdrawals", "提现审批"], ["approvals", "二级审批队列"]]) {
    ctx.renderAdminPage({ ...fixture(), view: "financeRefund", financeTab: tab });
    const html = elements["#adminScreen"].innerHTML;
    assert.equal((html.match(/<table>/g) || []).length, 1);
    assert.ok(html.includes(`<h2>${title}</h2>`));
    assert.ok(html.includes(`data-finance-tab="${tab}" aria-pressed="true"`));
  }
  ctx.renderAdminPage({ ...fixture({ user: '"><script>bad</script>' }), view: "financeRefund" });
  assert.doesNotMatch(elements["#adminScreen"].innerHTML, /<script>/);
  assert.match(elements["#adminScreen"].innerHTML, /&lt;script&gt;/);
});

function controls(confirm) {
  const state = { products: [{ id: "p1", name: "苹果", revision: 2 }, { id: "p2", name: "香蕉", revision: 3 }], identity: { permissions: ["product:write"] } };
  const requests = []; let reloads = 0;
  const ctx = load("catalog-controls.js", { document: { querySelectorAll: () => [] } });
  const controller = ctx.createCatalogControls(state, { confirm, api: async (url, options) => requests.push({ url, body: JSON.parse(options.body), method: options.method }), render() {}, reload: async () => { reloads++; } });
  const event = (dataset, attrs = []) => ({ target: { closest: () => ({ dataset, hasAttribute: name => attrs.includes(name), disabled: false }) } });
  return { state, requests, controller, event, reloads: () => reloads };
}

test("cancelled product/category deletion sends no mutation; confirmed delete uses the displayed revision", async () => {
  const cancelled = controls(async () => null);
  await cancelled.controller.click(cancelled.event({ productDelete: "p1" }));
  await cancelled.controller.click(cancelled.event({ categoryDelete: "水果" }));
  assert.equal(cancelled.requests.length, 0);
  const confirmed = controls(async () => ({}));
  await confirmed.controller.click(confirmed.event({ productDelete: "p1" }));
  assert.equal(confirmed.requests[0].method, "DELETE");
  assert.equal(confirmed.requests[0].body.expectedRevision, 2);
  assert.equal(confirmed.reloads(), 1);
});

test("position control sends the complete order and handles drag insertion after a target", async () => {
  const h = controls(async () => ({ position: 1 }));
  await h.controller.click(h.event({ productPosition: "p2" }, ["data-product-position"]));
  assert.deepEqual(h.requests[0].body, { position: 1, expectedOrder: ["p1", "p2"], expectedRevision: 3 });
  const row = id => ({ dataset: { productRow: id }, classList: { add() {} }, getBoundingClientRect: () => ({ top: 0, height: 40 }) });
  h.controller.dragstart({ target: { closest: () => row("p1") }, dataTransfer: { setData() {} }, preventDefault() {} });
  await h.controller.drop({ target: { closest: () => row("p2") }, clientY: 35, preventDefault() {} });
  assert.equal(h.requests[1].body.position, 2);
});

test("read-only users cannot delete or reorder products", async () => {
  const h = controls(async () => { throw new Error("must not show confirmation"); });
  h.state.identity.permissions = ["product:read"];
  await h.controller.click(h.event({ productDelete: "p1" }));
  await h.controller.click(h.event({ productPosition: "p1" }, ["data-product-position"]));
  assert.equal(h.requests.length, 0);
});
