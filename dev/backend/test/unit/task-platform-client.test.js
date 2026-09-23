const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const client = require("../../src/services/task-platform-client");
const { validateRuntimeConfig } = require("../../src/config/runtime-config");

function configure(t, overrides = {}) {
  const values = { TGG_TASK_PLATFORM_BASE_URL: "https://example.invalid/", TGG_TASK_PLATFORM_APPID: "test-app", TGG_TASK_PLATFORM_KEY: "test-key", TGG_TASK_PLATFORM_TIME_ZONE: "Asia/Shanghai", TGG_TASK_PLATFORM_TIMEOUT_MS: "100", ...overrides };
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("signature calendar is explicit across Shanghai midnight and supports provider time zone overrides", t => {
  configure(t);
  const expected = day => crypto.createHash("md5").update(day + "test-apptest-key").digest("hex");
  assert.equal(client.buildSign(new Date("2026-09-17T15:59:59Z")), expected("20260917"));
  assert.equal(client.buildSign(new Date("2026-09-17T16:00:00Z")), expected("20260918"));
  process.env.TGG_TASK_PLATFORM_TIME_ZONE = "UTC";
  assert.equal(client.buildSign(new Date("2026-09-17T16:00:00Z")), expected("20260917"));
});

test("payload cannot override provider credentials and documented empty registration response succeeds", async t => {
  configure(t);
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url.origin, "https://example.invalid");
    assert.equal(options.body.get("appid"), "test-app");
    assert.notEqual(options.body.get("sign"), "injected");
    assert.equal(options.body.get("mobile"), "13800138000");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ code: 0, data: {} }) };
  });
  assert.deepEqual(await client.post("index/index/task_register", { appid: "injected", sign: "injected", mobile: "13800138000" }), {});
});

test("HTTP, malformed JSON and platform business errors fail without exposing provider response text", async t => {
  configure(t);
  for (const response of [
    { ok: false, json: async () => ({ code: 0, data: {} }) },
    { ok: true, json: async () => { throw new Error("private provider details"); } },
    { ok: true, json: async () => ({ code: 1, msg: "private provider details", data: {} }) },
    { ok: true, json: async () => null },
    { ok: true, json: async () => ({ code: 0 }) }
  ]) {
    t.mock.method(global, "fetch", async () => response);
    await assert.rejects(client.post("index/index/task_list"), error => error.status === 502 && !error.message.includes("private"));
  }
});

for (const phase of ["headers", "body"]) {
  test(`timeout covers waiting for response ${phase} without automatic retry`, async t => {
    configure(t);
    let calls = 0;
    t.mock.method(global, "fetch", async (url, options) => {
      calls++;
      const stalled = () => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      return phase === "headers" ? stalled() : { ok: true, json: stalled };
    });
    await assert.rejects(client.post("index/index/task_register"), error => error.status === 504);
    assert.equal(calls, 1);
  });
}

test("runtime rejects invalid timeout and calendar configuration", () => {
  for (const timeout of ["0", "-1", "12.5", "60001", "abc"]) assert.equal(validateRuntimeConfig({ TGG_TASK_PLATFORM_TIMEOUT_MS: timeout }, false).ok, false);
  assert.equal(validateRuntimeConfig({ TGG_TASK_PLATFORM_TIME_ZONE: "Not/AZone" }, false).ok, false);
  assert.equal(validateRuntimeConfig({ TGG_TASK_PLATFORM_TIME_ZONE: "Asia/Shanghai", TGG_TASK_PLATFORM_TIMEOUT_MS: "10000" }, false).ok, true);
});

test("documented step img fields become usable image lists without losing instructions", t => {
  configure(t);
  const result = client.normalizeTaskDetail({ id: "task", users_ratio: "0", reward: "50", content: [
    { txt: "步骤一", img: "https://example.invalid/one.png" },
    { txt: "步骤二", img: "/two.png,https://example.invalid/three.png" },
    { txt: "步骤三", img_list: ["https://example.invalid/four.png", "https://example.invalid/four.png"], img: "ignored.png" },
    { txt: "步骤四", img: ["javascript:alert(1)", "data:image/png;base64,test", "", "/five.png"] },
    null
  ] });
  assert.equal(result.rewardPoints, 0);
  assert.equal(result.content.length, 4);
  assert.equal(result.content[0].txt, "步骤一");
  assert.deepEqual(result.content.map(block => block.img_list), [
    ["https://example.invalid/one.png"],
    ["https://example.invalid/two.png", "https://example.invalid/three.png"],
    ["https://example.invalid/four.png"],
    ["https://example.invalid/five.png"]
  ]);
});

test("provider invitation allocation is preserved on task detail and converted to points", () => {
  const detail = client.normalizeTaskDetail({
    id: "task",
    users_ratio: "11.90",
    invitation_ratio: "1.70",
    agency_ratio: "3.40",
    commission_reward: "0.00",
    commission_sy_reward: "17.00",
    option: []
  });
  assert.equal(detail.invitationRatio, "1.70");
  assert.equal(detail.inviteCommissionPoints, 17);
  assert.equal(detail.agencyRatio, "3.40");
  assert.equal(detail.commissionSyReward, "17.00");
});

test("runtime refuses missing production platform credentials or partially configured development connections", () => {
  const empty = validateRuntimeConfig({}, true);
  assert.ok(empty.errors.some(error => error.includes("TGG_TASK_PLATFORM_KEY is required")));
  const partial = validateRuntimeConfig({ TGG_TASK_PLATFORM_APPID: "test" }, false);
  assert.equal(partial.ok, false);
  const valid = { TGG_TASK_PLATFORM_BASE_URL: "https://example.invalid/api/", TGG_TASK_PLATFORM_APPID: "test", TGG_TASK_PLATFORM_KEY: "test-key" };
  assert.equal(validateRuntimeConfig(valid, false).ok, true);
  for (const base of ["invalid", "file:///tmp", "https://user:password@example.invalid", "https://example.invalid/?key=secret"]) assert.equal(validateRuntimeConfig({ ...valid, TGG_TASK_PLATFORM_BASE_URL: base }, false).ok, false);
});

test("invalid provider rewards remain invalid while true zero and valid decimals are preserved", () => {
  for (const reward of [undefined, null, "", "  ", -1, "-0.01", "NaN", Infinity, true, {}, "1e5", Number.MAX_SAFE_INTEGER]) {
    const detail = client.normalizeTaskDetail({ id: "task", users_ratio: reward });
    assert.equal(detail.rewardValid, false, String(reward));
    assert.equal(detail.rewardPoints, null);
  }
  for (const [reward, points] of [["0", 0], [0, 0], ["11.90", 119], [" 4.20 ", 42]]) {
    const detail = client.normalizeTaskDetail({ id: "task", users_ratio: reward, reward: "99" });
    assert.equal(detail.rewardValid, true);
    assert.equal(detail.rewardPoints, points);
  }
});
