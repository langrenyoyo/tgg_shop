process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { getSummary } = require("../../src/services/admin-service");

test("dashboard series uses real filtered orders and includes the complete end date", () => {
  const state = createSeed();
  state.orders = [
    { id: "start", createdAt: "2026-08-01T00:00:00", status: "paid", paymentMode: "cash", cashAmount: 10 },
    { id: "end", createdAt: "2026-08-02T23:59:59.999", status: "refunding", paymentMode: "cash", cashAmount: 25 },
    { id: "points", createdAt: "2026-08-02T12:00:00", status: "paid", paymentMode: "pure_points", cashAmount: 0 },
    { id: "outside", createdAt: "2026-08-03T00:00:00", status: "paid", paymentMode: "cash", cashAmount: 999 }
  ];
  state.pointLedger = [{ createdAt: "2026-08-02T13:00:00", direction: "out", points: 20 }];
  const result = getSummary(state, { startDate: "2026-08-01", endDate: "2026-08-02", paymentMode: "cash" }).analytics.dashboard;
  assert.deepEqual(result.selectedOrderIds, ["start", "end"]);
  assert.equal(result.series.length, 2);
  assert.equal(result.series.reduce((total, item) => total + item.orderCount, 0), result.selected.orderCount);
  assert.equal(result.series.reduce((total, item) => total + item.gmv, 0), 35);
  assert.equal(result.series[1].pointNet, -20);
});

test("empty and long dashboard ranges have zero-filled bounded series", () => {
  const state = createSeed();
  state.orders = [];
  state.pointLedger = [];
  const result = getSummary(state, { startDate: "2000-01-01", endDate: "2026-12-31" }).analytics.dashboard;
  assert.ok(result.series.length <= 30);
  assert.ok(result.series.every(item => item.orderCount === 0 && item.gmv === 0 && item.pointNet === 0));
  const today = getSummary(state, { range: "today" }).analytics.dashboard;
  assert.equal(today.series.length, 24);
});
