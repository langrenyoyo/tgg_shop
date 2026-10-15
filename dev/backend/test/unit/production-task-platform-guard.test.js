process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const taskService = require("../../src/services/task-service");
const { reviewTaskSubmission } = require("../../src/services/admin-service");
const taskPlatform = require("../../src/services/task-platform-client");

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("live PostgreSQL does not fall back to local tasks when the platform is unconfigured", async t => {
  const previous = {
    TGG_STORE_DRIVER: process.env.TGG_STORE_DRIVER,
    TGG_TEST_BYPASS_ENABLED: process.env.TGG_TEST_BYPASS_ENABLED
  };
  process.env.TGG_STORE_DRIVER = "pg";
  process.env.TGG_TEST_BYPASS_ENABLED = "0";
  t.mock.method(taskPlatform, "isConfigured", () => false);
  t.after(() => restoreEnv(previous));

  const state = createSeed();
  await assert.rejects(() => taskService.listTasksForUser(state), error => error.status === 503);
  assert.equal(state.submissions.length, 0);
});

test("live PostgreSQL does not process local task callbacks or manual reviews without the platform", async t => {
  const previous = {
    TGG_STORE_DRIVER: process.env.TGG_STORE_DRIVER,
    TGG_TEST_BYPASS_ENABLED: process.env.TGG_TEST_BYPASS_ENABLED
  };
  process.env.TGG_STORE_DRIVER = "pg";
  process.env.TGG_TEST_BYPASS_ENABLED = "0";
  t.mock.method(taskPlatform, "isConfigured", () => false);
  t.after(() => restoreEnv(previous));

  const state = createSeed();
  const before = JSON.stringify(state);
  await assert.rejects(
    () => taskService.processTaskCallback(state, { id: "local", sf_uid: "u_1001", status: 1, remarks: "review" }),
    error => error.status === 503
  );
  assert.equal(reviewTaskSubmission(state, "missing", "approved", "review", {}).status, 503);
  assert.equal(JSON.stringify(state), before);
});
