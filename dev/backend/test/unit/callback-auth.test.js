process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { authenticateCallback } = require("../../src/services/callback-auth");
const { handleAccountRoutes } = require("../../src/routes/account-routes");
test("callback uses an independent secret, never a user login token", t => {
  const name = "TGG_TASK_CALLBACK_TOKEN";
  const previous = process.env[name];
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  const url = new URL("https://example.com/api/task/callback");
  delete process.env[name];
  assert.equal(authenticateCallback({ headers: {} }, url, name, "x-task-callback-token").status, 503);
  process.env[name] = "test-callback-secret";
  assert.equal(authenticateCallback({ headers: { authorization: "Bearer user-token" } }, url, name, "x-task-callback-token").status, 401);
  assert.equal(authenticateCallback({ headers: { "x-task-callback-token": "wrong" } }, url, name, "x-task-callback-token").status, 401);
  assert.equal(authenticateCallback({ headers: { "x-task-callback-token": "test-callback-secret" } }, url, name, "x-task-callback-token").ok, true);
  url.searchParams.set("token", "test-callback-secret");
  assert.equal(authenticateCallback({ headers: {} }, url, name, "x-task-callback-token").ok, true);
});

test("withdrawal callback rejects before reading body when independent token is absent", async () => {
  const previous = process.env.HF_CALLBACK_TOKEN; delete process.env.HF_CALLBACK_TOKEN;
  try {
    let status;
    await handleAccountRoutes({ req: { method: "POST", headers: {} }, url: new URL("https://example.com/api/providers/huifu/withdraw-callback"), state: {}, user: null, readBody() { assert.fail("body must not be read"); }, send: (_, code) => { status = code; } });
    assert.equal(status, 503);
  } finally { if (previous === undefined) delete process.env.HF_CALLBACK_TOKEN; else process.env.HF_CALLBACK_TOKEN = previous; }
});
