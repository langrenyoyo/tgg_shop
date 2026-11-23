process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder } = require("../../src/domain/rules");
const orders = require("../../src/services/user-order-service");
const { orderCounts } = require("../../src/domain/order-item-view");
const { handleAuthRoutes } = require("../../src/routes/auth-routes");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");

test("order item display snapshots survive catalog edits and deletion without changing settlement", () => {
  const state = createSeed(), product = state.products.find(row => row.id === "p_apple");
  product.costPrice = 123; product.regularPrice = 12; product.image = "/uploads/apple.png";
  const order = createOrder(state, "u_1001", { paymentMode: "cash", items: [{ productId: product.id, quantity: 2 }] }).order;
  assert.ok(order);
  const originalCash = order.cashAmount, originalPrice = product.cashPrice;
  product.cashPrice = 999; product.regularPrice = 1000; product.name = "新名称";
  let detail = orders.detail(state, "u_1001", order.id);
  assert.equal(detail.items[0].product.cashPrice, originalPrice);
  assert.equal(detail.items[0].product.regularPrice, 12);
  assert.equal(detail.items[0].priceIsCurrent, false);
  assert.equal(detail.items[0].product.costPrice, undefined);
  assert.equal(detail.items[0].productSnapshot.costPrice, undefined);
  assert.equal(detail.cashAmount, originalCash);
  saveSQLiteState(state, ":memory:");
  const restored = orders.detail(loadSQLiteState(":memory:"), "u_1001", order.id);
  assert.deepEqual(restored.items, detail.items);
  assert.equal(restored.cashAmount, originalCash);
  state.products = state.products.filter(row => row.id !== product.id);
  detail = orders.detail(state, "u_1001", order.id);
  assert.equal(detail.items[0].product.image, "/uploads/apple.png");
  assert.equal(detail.cashAmount, originalCash);
  assert.equal(orders.detail(state, "u_1002", order.id), null);
});

test("legacy items label current catalog prices as references and keep order totals", () => {
  const state = createSeed(), order = state.orders[0], item = order.items[0];
  delete item.productSnapshot;
  const cash = order.cashAmount, points = order.pointAmount;
  const view = orders.detail(state, order.userId, order.id);
  assert.equal(view.items[0].priceIsCurrent, true);
  assert.equal(view.cashAmount, cash); assert.equal(view.pointAmount, points);
  assert.equal(item.product, undefined);
  state.products = [];
  assert.equal(orders.detail(state, order.userId, order.id).items[0].product.name, item.title || item.productId);
});

test("profile counts ignore other owners and cancelled orders and match order tab statuses", async () => {
  const state = createSeed();
  state.orders = [
    { userId: "alice", status: "pending_payment" },
    { userId: "alice", status: "paid", fulfillmentStatus: "pending_pickup" },
    { userId: "alice", status: "paid", fulfillmentStatus: "shipping" },
    { userId: "alice", status: "refunding", fulfillmentStatus: "shipping" },
    { userId: "alice", status: "cancelled", fulfillmentStatus: "pending_pickup" },
    { userId: "bob", status: "pending_payment" }
  ];
  const expected = { pendingPayment: 1, pendingPickup: 1, shipping: 1, refunding: 1 };
  assert.deepEqual(orderCounts(state, "alice"), expected);
  assert.deepEqual(orderCounts(state, undefined), { pendingPayment: 0, pendingPickup: 0, shipping: 0, refunding: 0 });
  let response;
  await handleAuthRoutes({ req: { method: "GET" }, url: new URL("https://example.com/api/me"), state, user: { id: "alice" }, send: (res, status, body, headers) => { response = { status, body, headers }; } });
  assert.equal(response.status, 200); assert.deepEqual(response.body.orderCounts, expected);
  assert.equal(response.headers["Cache-Control"], "no-store");
});
