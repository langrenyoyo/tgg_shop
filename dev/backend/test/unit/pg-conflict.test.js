const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { newDb } = require("pg-mem");

test("conflicted process cannot expose stale state to new business requests", async () => {
  let conflict = false;
  const context = { module: { exports: {} }, __dirname, process: { env: { TGG_STORE_DRIVER: "pg" } }, require(name) {
    if (name === "path") return path;
    if (name === "fs") return fs;
    if (name === "./seed") return { createSeed: () => ({ orders: [] }) };
    if (name === "./state-normalizer") return { normalizeState: state => state };
    if (name === "./pg-store") return { initPgState: async () => ({ orders: [] }), hasPgWriteConflict: () => conflict };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../src/data/store.js"), "utf8"), context);
  const store = context.module.exports;
  await store.whenReady();
  assert.equal(store.getState().orders.length, 0);
  conflict = true;
  assert.throws(() => store.getState(), { code: "STATE_WRITE_CONFLICT" });
});

test("two PostgreSQL store instances cannot overwrite newer orders with a stale snapshot", async () => {
  const database = newDb({ noAstCoverageCheck: true });
  const adapter = database.adapters.createPg();
  function instance() {
    const context = { module: { exports: {} }, process: { env: { TGG_PG_URL: "postgres://test", TGG_PG_MEM: "1" } }, require(name) {
      if (name === "pg") return adapter;
      if (name === "./seed") return { createSeed: () => ({ orders: [], points: 100 }) };
      if (name === "./state-normalizer") return { normalizeState: state => state };
      throw new Error(name);
    } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../src/data/pg-store.js"), "utf8"), context);
    return context.module.exports;
  }
  const first = instance();
  const second = instance();
  const a = await first.initPgState();
  const b = await second.initPgState();
  a.orders.push({ id: "new-order" });
  a.points = 80;
  await first.savePgState(a);
  b.points = 50;
  await assert.rejects(second.savePgState(b), { code: "STATE_WRITE_CONFLICT" });
  assert.equal(second.isPgReady(), false);
  assert.equal(second.hasPgWriteConflict(), true);
  await assert.rejects(second.savePgState(b), { code: "STATE_WRITE_CONFLICT" });
  const reader = instance();
  const durable = await reader.initPgState();
  assert.equal(durable.orders[0].id, "new-order");
  assert.equal(durable.points, 80);
  // Only a fresh load with deliberate new changes can advance the database.
  durable.points = 70;
  await reader.savePgState(durable);
  await assert.rejects(first.savePgState(a), { code: "STATE_WRITE_CONFLICT" });
  await Promise.all([first.closePgPool(), second.closePgPool(), reader.closePgPool()]);
});
