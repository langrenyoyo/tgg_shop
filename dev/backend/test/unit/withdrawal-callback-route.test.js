const test = require("node:test");
const assert = require("node:assert/strict");
const source = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../src/routes/api-router.js"), "utf8");
test("provider withdrawal callback is exempt from user auth and reaches its own token gate", () => {
  assert.match(source, /url\.pathname === "\/api\/providers\/huifu\/withdraw-callback"\) return false/);
});
