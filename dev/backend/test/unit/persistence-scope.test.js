const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { trackSave, withPersistence } = require("../../src/data/persistence-scope");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("scope surfaces unawaited save failure even when a later save succeeds", async () => {
  const failure = new Error("disk unavailable");
  await assert.rejects(withPersistence(() => {
    trackSave(Promise.reject(failure));
    trackSave(Promise.resolve());
    return { ok: true };
  }), /disk unavailable/);
  assert.equal(await withPersistence(() => { trackSave(Promise.resolve()); return "recovered"; }), "recovered");
});

test("API buffers success responses until legacy saves settle and isolates concurrent requests", async () => {
  const pending = { first: deferred(), second: deferred() };
  const output = [];
  const context = { module: { exports: {} }, require(name) {
    if (name === "../data/store") return { getState: () => ({}) };
    if (name === "../data/persistence-scope") return { withPersistence };
    if (name === "../domain/auth") return { resolveUser: () => ({ ok: true, user: { id: "alice" } }) };
    if (name === "../http/http-utils") return { send: (res, status, body) => { output.push({ res, status, body }); return true; } };
    if (name === "./auth-routes") return { handleAuthRoutes: ctx => {
      trackSave(pending[ctx.req.id].promise);
      return ctx.send(ctx.res, 200, { ok: true });
    } };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../src/routes/api-router.js"), "utf8"), context);
  const route = context.module.exports.routeApi;
  const first = route({ id: "first", method: "POST" }, "first", new URL("https://example.com/api/test"));
  const rejected = assert.rejects(first, /write failed/);
  const second = route({ id: "second", method: "POST" }, "second", new URL("https://example.com/api/test"));
  await new Promise(setImmediate);
  assert.equal(output.length, 0);
  pending.second.resolve();
  await second;
  assert.equal(output.length, 1);
  assert.equal(output[0].res, "second");
  pending.first.reject(new Error("write failed"));
  await rejected;
  assert.equal(output.length, 1);
});
