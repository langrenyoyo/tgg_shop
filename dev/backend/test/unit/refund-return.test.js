process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const { createRefundRequest, approveRefund } = require("../../src/domain/refund-rules");
const { resolveReturn } = require("../../src/services/refund-return-service");
const { updateTicket } = require("../../src/services/admin-service");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");

function setup(items = [{ productId: "p_banana", quantity: 1 }]) {
  const state = createSeed();
  state.users.find(item => item.id === "u_1001").points = 100000;
  const order = createOrder(state, "u_1001", { paymentMode: "pure_points", items }).order;
  order.fulfillmentStatus = "picked_up";
  order.status = "completed";
  const refund = createRefundRequest(state, "u_1001", order.id, "售后").refundOrder;
  approveRefund(state, refund.id);
  return { state, refund, product: state.products.find(item => item.id === "p_banana"), actor: { adminId: "stock-admin", role: { id: "stock" } } };
}
test("return receipt restores inventory once and cannot be changed or bypassed by ticket resolution", async () => {
  const { state, refund, product, actor } = setup();
  const stock = product.stock;
  const ticket = state.operationTickets.find(item => item.linkedType === "refund_return");
  assert.equal(updateTicket(state, ticket.id, { status: "resolved" }, actor).status, 409);
  assert.equal((await resolveReturn(state, refund.id, { disposition: "restock", reason: "" }, actor)).status, 400);
  const input = { disposition: "restock", reason: "验收合格，仓库签收单 001" };
  assert.equal((await resolveReturn(state, refund.id, input, actor)).ok, true);
  assert.equal(product.stock, stock + 1);
  assert.equal(ticket.status, "resolved");
  assert.equal((await resolveReturn(state, refund.id, input, actor)).idempotent, true);
  assert.equal(product.stock, stock + 1);
  assert.equal((await resolveReturn(state, refund.id, { disposition: "no_restock", reason: "changed" }, actor)).status, 409);
  const database = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tgg-return-")), "return.sqlite");
  saveSQLiteState(state, database);
  const reloaded = loadSQLiteState(database);
  assert.equal((await resolveReturn(reloaded, refund.id, input, actor)).idempotent, true);
  assert.equal(reloaded.products.find(item => item.id === product.id).stock, stock + 1);
});
test("no-restock disposition closes follow-up without increasing stock", async () => {
  const { state, refund, product, actor } = setup();
  const stock = product.stock;
  assert.equal((await resolveReturn(state, refund.id, { disposition: "no_restock", reason: "损坏不再销售" }, actor)).ok, true);
  assert.equal(product.stock, stock);
});
test("return handling endpoint requires authenticated inventory permission", async () => {
  const { state, refund } = setup();
  let status;
  await handleAdminRoutes({ req: { method: "POST", headers: {} }, url: new URL(`https://example.com/api/admin/refund-returns/${refund.id}/resolve`), state, readBody() { assert.fail("Unauthorized body must not be processed"); }, send: (res, code) => { status = code; } });
  assert.ok([401, 403].includes(status));
});

const orderedItems = [{ productId: "p_banana", quantity: 3 }, { productId: "p_bokchoy", quantity: 2 }];
const inspectedItems = [{ productId: "p_banana", restockQuantity: 2 }, { productId: "p_bokchoy", restockQuantity: 0 }];

test("partial final inspection restores only accepted quantities and survives SQLite reload", async () => {
  const { state, refund, actor } = setup(orderedItems);
  const stocks = orderedItems.map(item => state.products.find(product => product.id === item.productId).stock);
  const ledgerCount = state.inventoryLedger.length;
  const input = { disposition: "partial", reason: "香蕉损坏一份，青菜全部报损", items: inspectedItems };
  assert.equal((await resolveReturn(state, refund.id, input, actor)).ok, true);
  assert.deepEqual(orderedItems.map(item => state.products.find(product => product.id === item.productId).stock), [stocks[0] + 2, stocks[1]]);
  assert.equal(state.inventoryLedger.length, ledgerCount + 1);
  assert.deepEqual(state.adminOperationLogs[0].after.items, [
    { productId: "p_banana", restockQuantity: 2, noRestockQuantity: 1 },
    { productId: "p_bokchoy", restockQuantity: 0, noRestockQuantity: 2 }
  ]);
  const retry = { ...input, items: [...input.items].reverse() };
  assert.equal((await resolveReturn(state, refund.id, retry, actor)).idempotent, true);
  const database = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tgg-partial-return-")), "return.sqlite");
  saveSQLiteState(state, database);
  const reloaded = loadSQLiteState(database);
  assert.equal((await resolveReturn(reloaded, refund.id, retry, actor)).idempotent, true);
  assert.equal((await resolveReturn(reloaded, refund.id, { ...input, items: [{ productId: "p_banana", restockQuantity: 3 }, inspectedItems[1]] }, actor)).status, 409);
  assert.equal(reloaded.products.find(item => item.id === "p_banana").stock, stocks[0] + 2);
  assert.equal(reloaded.inventoryLedger.length, ledgerCount + 1);
});

test("invalid partial quantities leave all stock, tickets and ledgers unchanged", async () => {
  const invalid = [undefined, [], [inspectedItems[0]], [inspectedItems[0], inspectedItems[0]],
    [inspectedItems[0], { productId: "foreign", restockQuantity: 0 }],
    ...[-1, 3, 0.5, "1", null].map(restockQuantity => [inspectedItems[0], { productId: "p_bokchoy", restockQuantity }]),
    [inspectedItems[0], null]];
  for (const items of invalid) {
    const { state, refund, actor } = setup(orderedItems);
    const before = JSON.stringify(state);
    assert.equal((await resolveReturn(state, refund.id, { disposition: "partial", reason: "验收", items }, actor)).status, 400);
    assert.equal(JSON.stringify(state), before);
  }
});

test("prevalidation refuses missing products and resolved tickets without evidence before stock mutation", async () => {
  for (const fault of ["missing_product", "missing_evidence"]) {
    const { state, refund, actor } = setup(orderedItems);
    if (fault === "missing_product") state.products = state.products.filter(item => item.id !== "p_bokchoy");
    else state.operationTickets.find(item => item.linkedType === "refund_return").status = "resolved";
    const before = JSON.stringify(state);
    assert.equal((await resolveReturn(state, refund.id, { disposition: "partial", reason: "验收", items: inspectedItems.map(item => ({ ...item, restockQuantity: 1 })) }, actor)).status, 409);
    assert.equal(JSON.stringify(state), before);
  }
});
