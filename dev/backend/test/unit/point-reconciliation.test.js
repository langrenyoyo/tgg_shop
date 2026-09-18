process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcilePoints } = require("../../src/services/point-reconciliation-service");
const entry = (id, points, balanceAfter, direction = "in") => ({ id, idempotencyKey: id, userId: "alice", points, balanceAfter, direction, createdAt: `2026-09-17T00:00:0${id}.000Z` });
const state = () => ({ users: [{ id: "alice", points: 110 }], pointLedger: [entry("2", 10, 110, "out"), entry("1", 20, 120)] });

test("point reconciliation checks saved chain without claiming opening balance verified or mutating state", () => {
  const data = state(), before = JSON.stringify(data);
  const result = reconcilePoints(data);
  assert.equal(result.rows[0].status, "consistent");
  assert.equal(result.rows[0].expectedBalance, 110);
  assert.equal(result.openingBalanceVerified, false);
  assert.equal(JSON.stringify(data), before);
});

test("balance discrepancy, missing intermediate posting and invalid values are detected", () => {
  for (const [modify, issue] of [
    [data => { data.users[0].points = 111; }, "balance_mismatch"],
    [data => { data.pointLedger[1].balanceAfter = 130; }, "broken_chain"],
    [data => { data.pointLedger[0].points = "10"; }, "invalid_entry"],
    [data => { data.pointLedger[0].createdAt = "invalid"; }, "invalid_entry"],
    [data => { data.pointLedger[1].points = 121; }, "invalid_entry"],
    [data => { data.users[0].points = -1; }, "invalid_balance"]
  ]) {
    const data = state(); modify(data);
    const row = reconcilePoints(data).rows[0];
    assert.equal(row.status, "mismatch"); assert.ok(row.issues.includes(issue));
  }
});

test("duplicate keys across users and orphaned ledger rows are visible", () => {
  const data = state(); data.pointLedger.push({ ...entry("1", 20, 20), userId: "missing" });
  const rows = reconcilePoints(data).rows;
  assert.ok(rows.every(row => row.issues.includes("duplicate_key") && row.issues.includes("duplicate_id")));
  assert.ok(rows.find(row => row.userId === "missing").issues.includes("missing_user"));
});

test("missing history and timestamp ties are unverified, not a zero-balance repair suggestion", () => {
  const data = state(); data.users.push({ id: "no-history", points: 1000 });
  data.pointLedger[0].createdAt = data.pointLedger[1].createdAt;
  const rows = reconcilePoints(data).rows;
  assert.ok(rows.every(row => row.status === "unverified" && row.expectedBalance === null));
  assert.ok(rows[0].issues.includes("timestamp_tie"));
});

test("admin ledger integrates full point reconciliation regardless of payment filters", () => {
  const { getLedger } = require("../../src/services/admin-service");
  const data = { ...state(), paymentLedger: [{ status: "paid" }, { status: "pending" }], withdrawableLedger: [] };
  data.users[0].points++;
  const result = getLedger(data, { paymentStatus: "pending" });
  assert.equal(result.paymentLedger.length, 1);
  assert.equal(result.pointReconciliation.rows[0].status, "mismatch");
  assert.equal(result.pointReconciliation.rows[0].entryCount, 2);
});
