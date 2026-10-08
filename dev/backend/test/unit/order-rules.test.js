process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { calcDeliveryDate, createOrder, payOrder } = require("../../src/domain/rules");

test("delivery cutoff uses Asia/Shanghai and rolls over at the configured hour", () => {
  const config = { deliveryTimeZone: "Asia/Shanghai", deliveryCutoffHour: 5 };
  assert.equal(calcDeliveryDate(config, "2026-09-11T02:59:00+08:00"), "2026-09-11");
  assert.equal(calcDeliveryDate(config, "2026-09-11T05:00:00+08:00"), "2026-09-12");
  assert.equal(calcDeliveryDate(config, "2026-09-11T04:59:59+08:00"), "2026-09-11");
});

test("delivery time slot must be one of the configured slots", () => {
  const invalid = createOrder(createSeed(), "u_1001", {
    paymentMode: "pure_points",
    fulfillmentType: "delivery",
    deliveryAddress: "师大东门宿舍 3 栋",
    deliveryTimeSlot: "22:00-23:00",
    items: [{ productId: "p_bokchoy", quantity: 1 }]
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /配送时间段无效/);

  const valid = createOrder(createSeed(), "u_1001", {
    paymentMode: "pure_points",
    fulfillmentType: "delivery",
    deliveryAddress: "师大东门宿舍 3 栋",
    deliveryTimeSlot: "14:00-18:00",
    items: [{ productId: "p_bokchoy", quantity: 1 }]
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.order.deliveryTimeSlot, "14:00-18:00");
});

test("normal user cannot create cash order", () => {
  const state = createSeed();
  const result = createOrder(state, "u_1002", {
    paymentMode: "cash",
    fulfillmentType: "pickup",
    items: [{ productId: "p_apple", quantity: 1 }]
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /下单需要先购买月会员/);
});

test("member can create pure-points pickup order without cash", () => {
  const state = createSeed();
  state.users.find(user => user.id === "u_1002").memberUntil = new Date(Date.now() + 86400000).toISOString();
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
  state.users.find(user => user.id === "u_1002").memberUntil = new Date(Date.now() + 86400000).toISOString();
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
  state.users.find(user => user.id === "u_1002").memberUntil = new Date(Date.now() + 86400000).toISOString();
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
  state.users.find(user => user.id === "u_1002").memberUntil = new Date(Date.now() + 86400000).toISOString();
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
  state.users.find(user => user.id === "u_1002").memberUntil = new Date(Date.now() + 86400000).toISOString();
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
  state.users.find(user => user.id === "u_1002").memberUntil = new Date(Date.now() + 86400000).toISOString();
  const product = state.products.find(item => item.purePointsOnly);
  const result = createOrder(state, "u_1001", { paymentMode: "points_plus_cash", items: [{ productId: product.id, quantity: 1 }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /纯积分商品/);
});

test("checkout retries do not deduct stock or points twice", () => {
  const state = createSeed();
  state.users.find(user => user.id === "u_1002").memberUntil = new Date(Date.now() + 86400000).toISOString();
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
    assert.equal(createOrder(createSeed(), "u_1001", { items: [{ productId: "p_banana", quantity }] }).ok, false);
  }
  assert.equal(createOrder(createSeed(), "u_1001", { items: [{ productId: "p_banana", quantity: 1 }, { productId: "p_banana", quantity: 1 }] }).ok, false);
});
