process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { createOrder, payOrder } = require("../../src/domain/rules");

test("normal user cannot create cash order", () => {
  const state = createSeed();
  const result = createOrder(state, "u_1002", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /现金购物需要先开通月会员/);
});

test("normal user can create pure-points pickup order without cash", () => {
  const state = createSeed();
  const before = state.users.find((user) => user.id === "u_1002").points;
  const result = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "pickup",
    items: [{ productId: "p_banana", quantity: 1 }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.status, "paid");
  assert.equal(result.order.fulfillmentStatus, "pending_pickup");
  assert.equal(result.order.cashAmount, 0);
  assert.ok(result.order.pickupCode);
  assert.equal(state.users.find((user) => user.id === "u_1002").points, before - result.order.pointAmount);
  assert.equal(state.pointLedger[0].bizNo, result.order.id);
});

test("pure-points delivery order never creates cash amount", () => {
  const state = createSeed();
  const result = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "delivery",
    deliveryAddress: "师大东门宿舍 3 栋",
    items: [{ productId: "p_bokchoy", quantity: 1 }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.cashAmount, 0);
  assert.equal(result.order.fulfillmentStatus, "pending_ship");
  assert.ok(result.order.deliveryDate);
});

test("pure-points order rejects insufficient points without cash top-up", () => {
  const state = createSeed();
  const result = createOrder(state, "u_1002", {
    paymentMode: "pure_points",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /积分不足/);
});

test("member cash order starts pending payment and can be paid once", () => {
  const state = createSeed();
  const created = createOrder(state, "u_1001", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });

  assert.equal(created.ok, true);
  assert.equal(created.order.status, "pending_payment");

  const paid = payOrder(state, created.order.id);
  assert.equal(paid.ok, true);
  assert.equal(paid.order.status, "paid");
  assert.equal(paid.order.fulfillmentStatus, "pending_pickup");
  assert.equal(state.paymentLedger[0].orderId, created.order.id);
  assert.equal(state.paymentLedger.length, 1);

  const secondPay = payOrder(state, created.order.id);
  assert.equal(secondPay.ok, true);
  assert.equal(secondPay.idempotent, true);
  assert.equal(state.paymentLedger.length, 1);
});

test("points plus cash uses user points once across the whole order", () => {
  const state = createSeed();
  // This scenario uses mixed-payment products, not the pure-points catalog.
  for (const product of state.products.filter(item => ["p_banana", "p_bokchoy"].includes(item.id))) product.purePointsOnly = false;
  const user = state.users.find((item) => item.id === "u_1001");
  user.points = 100;

  const result = createOrder(state, "u_1001", {
    paymentMode: "points_plus_cash",
    fulfillmentType: "pickup",
    items: [
      { productId: "p_banana", quantity: 1 },
      { productId: "p_bokchoy", quantity: 1 }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.pointAmount, 100);
  assert.equal(result.order.cashAmount, 18.7);
  assert.equal(result.order.status, "pending_payment");
});

test("pure-points products cannot be purchased using cash shortfall", () => {
  const state = createSeed();
  const product = state.products.find(item => item.purePointsOnly);
  const result = createOrder(state, "u_1001", { paymentMode: "points_plus_cash", items: [{ productId: product.id, quantity: 1 }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /纯积分商品/);
});

test("checkout retries do not deduct stock or points twice", () => {
  const state = createSeed();
  const payload = { idempotencyKey: "checkout-test", paymentMode: "pure_points", items: [{ productId: "p_banana", quantity: 1 }] };
  const first = createOrder(state, "u_1002", payload);
  assert.equal(first.ok, true);
  const points = state.users.find(item => item.id === "u_1002").points;
  const stock = state.products.find(item => item.id === "p_banana").stock;
  const second = createOrder(state, "u_1002", payload);
  assert.equal(second.order.id, first.order.id);
  assert.equal(state.users.find(item => item.id === "u_1002").points, points);
  assert.equal(state.products.find(item => item.id === "p_banana").stock, stock);
});

test("invalid quantities and duplicate product lines cannot bypass stock checks", () => {
  for (const quantity of [0, -1, 0.5, "invalid"]) {
    assert.equal(createOrder(createSeed(), "u_1002", { items: [{ productId: "p_banana", quantity }] }).ok, false);
  }
  assert.equal(createOrder(createSeed(), "u_1002", { items: [{ productId: "p_banana", quantity: 1 }, { productId: "p_banana", quantity: 1 }] }).ok, false);
});
