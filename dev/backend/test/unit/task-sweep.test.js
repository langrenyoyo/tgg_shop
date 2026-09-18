process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTaskSweep } = require("../../src/services/task-sweep-service");

function setup(overrides = {}) {
  const submissions = Array.from({ length: 5 }, (_, i) => ({ id: String(i), userId: "alice", platform: "bounty_platform", status: "reviewing" }));
  submissions.push({ id: "local", platform: "local_mock", status: "reviewing" }, { id: "done", platform: "bounty_platform", status: "approved" });
  const calls = [];
  const worker = createTaskSweep({ state: () => ({ submissions }), configured: () => true, batchSize: 2, persist: work => work(), sync: async (_, user, id) => { calls.push(id); assert.equal(user, "alice"); return { ok: false, status: 409 }; }, ...overrides });
  return { worker, calls, submissions };
}

test("task sweep rotates bounded batches past unresolved submissions and skips local/terminal records", async () => {
  const { worker, calls } = setup();
  assert.deepEqual(await worker.run(), { checked: 2, reconciled: 0, deferred: 2 });
  await worker.run(); await worker.run();
  assert.deepEqual(calls, ["0", "1", "2", "3", "4", "0"]);
});

test("concurrent sweep triggers share one execution and shutdown drains the active record", async () => {
  let release, calls = 0;
  const { worker } = setup({ sync: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = worker.run(), second = worker.run();
  assert.equal(first, second);
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  await new Promise(setImmediate);
  assert.equal(stopped, false);
  release({ ok: true }); await stop; await first;
  assert.equal(calls, 1);
  assert.deepEqual(await worker.run(), { checked: 0, reconciled: 0, deferred: 0 });
});

test("provider or persistence failure releases sweep lock and next sweep advances", async () => {
  for (const failureAt of ["sync", "persist"]) {
    const calls = [];
    let fail = true;
    const { worker } = setup({
      sync: async (_, user, id) => { calls.push(id); if (fail && failureAt === "sync") { fail = false; throw new Error("timeout"); } return { ok: true }; },
      persist: async work => { const result = await work(); if (fail && failureAt === "persist") { fail = false; throw new Error("save failed"); } return result; }
    });
    await assert.rejects(worker.run());
    assert.equal((await worker.run()).checked, 2);
    assert.deepEqual(calls, ["0", "1", "2"]);
  }
});

test("unconfigured task platform never performs background reads", async () => {
  const { worker, calls } = setup({ configured: () => false });
  assert.equal((await worker.run()).checked, 0);
  assert.equal(calls.length, 0);
});
