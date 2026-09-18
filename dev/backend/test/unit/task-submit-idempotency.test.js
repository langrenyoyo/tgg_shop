process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const platform = require("../../src/services/task-platform-client");
const { submitTask } = require("../../src/services/task-service");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("mini task attempt keeps its key and form across page reopening after uncertain submit", async () => {
  const storage = new Map([["tgg_user", { id: "alice" }]]);
  const submitted = [];
  let succeed = false;
  let failureStatus;
  function open() {
    let page;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/task-submit/index.js"), "utf8"), {
      Page: value => { page = value; },
      require: () => ({ request: async (url, options) => {
        if (!options) return { id: "task-a", submitFields: [] };
        submitted.push(options.data);
        if (!succeed) throw Object.assign(new Error("submit failed"), { statusCode: failureStatus });
        return { id: "submission-a" };
      } }),
      wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast() {}, switchTab() {} }
    });
    page.setData = data => Object.assign(page.data, data);
    page.onLoad({ id: "task-a" });
    return page;
  }
  const first = open();
  await new Promise(setImmediate);
  first.data.form = { mobile: "13800138000" };
  first.data.images = ["https://example.com/proof.png"];
  await first.submit();
  assert.equal(first.data.awaitingResult, true);
  first.onInput({ currentTarget: { dataset: { name: "mobile" } }, detail: { value: "changed" } });
  first.clearImages();
  assert.equal(first.data.form.mobile, "13800138000");
  assert.equal(first.data.images.length, 1);
  const retry = open();
  await new Promise(setImmediate);
  assert.equal(retry.data.form.mobile, "13800138000");
  assert.equal(retry.data.awaitingResult, true);
  retry.data.task.paused = true;
  retry.data.fields = [{ name: "new_required_field" }];
  succeed = true;
  await retry.submit();
  assert.equal(submitted[1].idempotencyKey, submitted[0].idempotencyKey);
  assert.deepEqual({ ...submitted[1] }, { ...submitted[0] });
  assert.equal(storage.has("tgg_task_attempt_alice_task-a"), false);
  storage.set("tgg_user", { id: "bob" });
  await retry.submit();
  assert.equal(submitted.length, 2);
  const correctable = open();
  await new Promise(setImmediate);
  succeed = false;
  failureStatus = 400;
  await correctable.submit();
  assert.equal(correctable.data.awaitingResult, false);
  assert.equal(storage.has("tgg_task_attempt_bob_task-a"), false);
  // Membership expiry does not prove that an earlier attempt was never received.
  failureStatus = 403;
  await correctable.submit();
  assert.equal(correctable.data.awaitingResult, true);
  assert.equal(storage.has("tgg_task_attempt_bob_task-a"), true);
});

test("concurrent detail lookups with the same key register with the provider once", async t => {
  const state = createSeed();
  const user = state.users[0];
  const details = [];
  let releaseRegister;
  let registered = 0;
  t.mock.method(platform, "isConfigured", () => true);
  t.mock.method(platform, "post", async endpoint => {
    if (endpoint.endsWith("task_info")) return new Promise(resolve => details.push(resolve));
    registered += 1;
    return new Promise(resolve => { releaseRegister = resolve; });
  });
  const payload = { idempotencyKey: "one-click", mobile: "13800138000" };
  const first = submitTask(state, user, "remote-task", payload);
  const second = submitTask(state, user, "remote-task", payload);
  for (const resolve of details) resolve({ id: "remote-task", title: "Remote", users_ratio: "1" });
  await new Promise(setImmediate);
  assert.equal(registered, 1);
  assert.equal((await second).status, 409);
  releaseRegister({});
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(state.submissions.filter(item => item.payload?.raw?.idempotencyKey === "one-click").length, 1);
  const replay = await submitTask(state, user, "remote-task", payload);
  assert.equal(replay.submission.id, result.submission.id);
  assert.equal(replay.idempotent, true);
  assert.equal((await submitTask(state, user, "remote-task", { ...payload, mobile: "13900139000" })).status, 409);
  assert.equal(registered, 1);
});

test("uncertain provider registration stays uncertain on retry without another external write", async t => {
  const state = createSeed();
  let registered = 0;
  t.mock.method(platform, "isConfigured", () => true);
  t.mock.method(platform, "post", async endpoint => {
    if (endpoint.endsWith("task_info")) return { id: "remote-task", title: "Remote", users_ratio: "1" };
    registered += 1;
    throw new Error("timeout after provider accepted request");
  });
  const payload = { idempotencyKey: "uncertain" };
  assert.equal((await submitTask(state, state.users[0], "remote-task", payload)).status, 502);
  const retry = await submitTask(state, state.users[0], "remote-task", payload);
  assert.equal(retry.status, 409);
  assert.equal(retry.ok, false);
  assert.equal(registered, 1);
});

test("required platform fields reject invalid content without local intent or external writes and allow corrected retry", async t => {
  const state = createSeed();
  let registered = 0;
  t.mock.method(platform, "isConfigured", () => true);
  t.mock.method(platform, "post", async (endpoint, payload) => {
    if (endpoint.endsWith("task_info")) return { id: "remote-task", title: "Remote", users_ratio: "1", option: ["mobile", "imgea"] };
    registered += 1;
    assert.equal(payload.mobile, "13800138000");
    assert.equal(payload.images, "https://example.com/proof.png");
    return {};
  });
  const before = JSON.stringify(state);
  for (const payload of [null, [], { idempotencyKey: {} }, { mobile: {} }, { mobile: " " }, { mobile: "13800138000", images: "  " }]) {
    assert.equal((await submitTask(state, state.users[0], "remote-task", payload)).status, 400);
    assert.equal(JSON.stringify(state), before);
  }
  const key = "correctable";
  assert.equal((await submitTask(state, state.users[0], "remote-task", { idempotencyKey: key })).status, 400);
  assert.equal(registered, 0);
  assert.equal((await submitTask(state, state.users[0], "remote-task", { idempotencyKey: key, phone: "13800138000", screenshot: "https://example.com/proof.png" })).ok, true);
  assert.equal(registered, 1);
});

test("unknown required fields fail explicitly and legacy local fields normalize without discarding proof", async t => {
  const state = createSeed();
  t.mock.method(platform, "isConfigured", () => false);
  const task = state.tasks[0];
  task.submitFields = ["unsupported_field"];
  const before = JSON.stringify(state);
  assert.equal((await submitTask(state, state.users[0], task.id, { unsupported_field: "value" })).status, 503);
  assert.equal(JSON.stringify(state), before);
  task.submitFields = ["手机号", "截图凭证"];
  const result = await submitTask(state, state.users[0], task.id, { "手机号": "13800138000", "截图凭证": "https://example.com/proof.png" });
  assert.equal(result.ok, true);
  assert.equal(result.submission.payload.mobile, "13800138000");
  assert.equal(result.submission.payload.images, "https://example.com/proof.png");
  assert.deepEqual(result.submission.taskSnapshot.submitFields, ["mobile", "images"]);
});

test("invalid platform rewards reject before external registration and valid retry snapshots reward", async t => {
  const state = createSeed();
  let reward = "-1", writes = 0;
  t.mock.method(platform, "isConfigured", () => true);
  t.mock.method(platform, "post", async endpoint => {
    if (endpoint.endsWith("task_info")) return { id: "remote", title: "Remote", users_ratio: reward, option: [] };
    writes++; return {};
  });
  const before = JSON.stringify(state);
  const payload = { idempotencyKey: "reward-retry" };
  assert.equal((await submitTask(state, state.users[0], "remote", payload)).status, 503);
  assert.equal(writes, 0); assert.equal(JSON.stringify(state), before);
  reward = "4.20";
  const result = await submitTask(state, state.users[0], "remote", payload);
  assert.equal(result.ok, true); assert.equal(result.submission.taskSnapshot.rewardPoints, 42);
  reward = "invalid";
  assert.equal((await submitTask(state, state.users[0], "remote", payload)).idempotent, true);
  assert.equal(writes, 1);
});
