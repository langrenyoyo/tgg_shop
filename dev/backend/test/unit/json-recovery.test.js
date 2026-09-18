const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("JSON save rejects a failed write and persists subsequent retries", async () => {
  let failWrite = false;
  let durable;
  let temporary;
  const revisions = [];
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/data/store.js"), "utf8");
  const context = {
    module: { exports: {} }, __dirname,
    process: { env: { TGG_STORE_DRIVER: "json", TGG_STORE_FILE: "test-store.json" } },
    require(name) {
      if (name === "fs") return {
        existsSync: () => false, mkdirSync() {},
        writeFileSync(file, content) {
          if (failWrite) throw new Error("disk unavailable");
          temporary = content;
        },
        renameSync() { durable = temporary; revisions.push(JSON.parse(durable).revision); }
      };
      if (name === "path") return path;
      if (name === "./persistence-scope") return require("../../src/data/persistence-scope");
      if (name === "./seed") return { createSeed: () => ({ users: [], revision: 0 }) };
      if (name === "./state-normalizer") return { normalizeState: state => state };
      return {};
    }
  };
  vm.runInNewContext(source, context);
  const store = context.module.exports;
  store.getState().revision = 1;
  failWrite = true;
  await assert.rejects(store.saveState(), /disk unavailable/);
  assert.equal(JSON.parse(durable).revision, 0);
  failWrite = false;
  await store.saveState();
  assert.equal(JSON.parse(durable).revision, 1);
  store.getState().revision = 2;
  const second = store.saveState();
  store.getState().revision = 3;
  const third = store.saveState();
  store.getState().revision = 4;
  await Promise.all([second, third]);
  assert.deepEqual(revisions.slice(-2), [2, 3]);
  assert.equal(JSON.parse(durable).revision, 3);
});
