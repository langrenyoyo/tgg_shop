const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("payment callback never acknowledges before persistence and rejects on disk failure", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/routes/order-routes.js"), "utf8");
  let completeSave;
  const responses = [];
  const context = { module: { exports: {} }, require(name) {
    if (name === "../services/order-service") return { handleLfwinPaymentNotification: () => ({ ok: true }) };
    if (name === "../data/store") return { saveState: () => new Promise((resolve, reject) => { completeSave = { resolve, reject }; }) };
    return {};
  } };
  vm.runInNewContext(source, context);
  const ctx = { req: { method: "POST" }, url: new URL("https://example.com/api/payment-providers/lfwin/notify"), state: {}, readBody: async () => ({}), send: (res, status, body) => { responses.push({ status, body }); } };
  const pending = context.module.exports.handleOrderRoutes(ctx);
  await new Promise(setImmediate);
  assert.equal(responses.length, 0);
  completeSave.resolve();
  await pending;
  assert.equal(responses[0].body, "success");
  responses.length = 0;
  const failure = context.module.exports.handleOrderRoutes(ctx);
  await new Promise(setImmediate);
  completeSave.reject(new Error("storage unavailable"));
  await assert.rejects(failure, /storage unavailable/);
  assert.equal(responses.length, 0);
});
