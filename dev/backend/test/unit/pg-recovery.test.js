const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("PG write rejects on outage and later snapshots persist after recovery", async () => {
  const filename = path.resolve(__dirname, "../../src/data/pg-store.js");
  let fail = true;
  let failConnect = false;
  const written = [];
  let released = 0;
  class Pool {
    async connect() { if (failConnect) throw new Error("pool unavailable"); return {
      async query(sql, params) { if (fail) throw new Error("connection lost"); written.push(JSON.parse(params[1])); return { rowCount: 1 }; },
      release() { released++; }
    }; }
  }
  const context = {
    module: { exports: {} }, process: { env: { TGG_PG_URL: "postgres://test" } },
    require(name) {
      if (name === "pg") return { Pool };
      if (name === "./seed") return { createSeed: () => ({}) };
      if (name === "./state-normalizer") return { normalizeState: state => state };
      throw new Error(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  const store = context.module.exports;
  await assert.rejects(store.savePgState({ version: 1 }), /connection lost/);
  await assert.rejects(store.flushPgState(), /connection lost/);
  assert.equal(store.isPgReady(), false);
  fail = false;
  await store.savePgState({ version: 2 });
  await store.flushPgState();
  assert.equal(store.isPgReady(), true);
  assert.deepEqual(written, [{ version: 2 }]);
  assert.equal(released, 2);
  failConnect = true;
  await assert.rejects(store.savePgState({ version: 3 }), /pool unavailable/);
  assert.equal(store.isPgReady(), false);
  assert.equal(released, 2);
  failConnect = false;
  await store.savePgState({ version: 4 });
  assert.equal(store.isPgReady(), true);
  assert.deepEqual(written, [{ version: 2 }, { version: 4 }]);
});
