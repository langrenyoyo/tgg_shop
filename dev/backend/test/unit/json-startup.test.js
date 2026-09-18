const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

for (const reason of ["malformed", "unreadable"]) {
  test(`JSON startup preserves ${reason} existing store instead of overwriting balances`, () => {
    let writes = 0;
    const context = {
      module: { exports: {} }, __dirname,
      process: { env: { TGG_STORE_DRIVER: "json", TGG_STORE_FILE: "existing-store.json" } },
      require(name) {
        if (name === "fs") return {
          existsSync: () => true,
          readFileSync() { if (reason === "unreadable") throw new Error("access denied"); return "{broken"; },
          mkdirSync() {}, writeFileSync() { writes += 1; }, renameSync() { writes += 1; }
        };
        if (name === "path") return path;
        if (name === "./seed") return { createSeed: () => ({ users: [] }) };
        if (name === "./state-normalizer") return { normalizeState: state => state };
        return {};
      }
    };
    const source = fs.readFileSync(path.resolve(__dirname, "../../src/data/store.js"), "utf8");
    assert.throws(() => vm.runInNewContext(source, context));
    assert.equal(writes, 0);
  });
}
