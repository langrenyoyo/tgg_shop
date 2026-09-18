process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const { getPointLedger } = require("../../src/services/account-service");
const { handleAccountRoutes } = require("../../src/routes/account-routes");

test("ledger filters before paging with stable ties and does not link to another user's submission", () => {
  const state = createSeed();
  state.submissions = [{ id: "foreign-sub", userId: "bob" }];
  state.pointLedger = [
    { id: "1", userId: "alice", changeType: "invite_commission", direction: "in", bizNo: "foreign-sub", createdAt: "2026-09-17" },
    { id: "2", userId: "bob", changeType: "invite_commission", direction: "in", createdAt: "2026-09-17" },
    { id: "3", userId: "alice", changeType: "invite_commission", direction: "in", createdAt: "2026-09-17" },
    { id: "4", userId: "alice", changeType: "shopping_deduct", direction: "out", createdAt: "2026-09-18" }
  ];
  const query = { page: "1", count: "1", type: "invite_commission", direction: "in" };
  const first = getPointLedger(state, "alice", query);
  assert.equal(first.total, 2);
  assert.equal(first.rows[0].id, "3");
  const second = getPointLedger(state, "alice", { ...query, page: "2" });
  assert.equal(second.rows[0].id, "1");
  assert.deepEqual(second.rows[0].source, { type: "invite" });
  assert.equal(Array.isArray(getPointLedger(state, "alice")), true);
});

test("ledger endpoint rejects invalid pagination and direction", async () => {
  for (const query of ["page=0", "page=", "page=1.5", "page=1000001", "count=101", "count=bad", "direction=bad"]) {
    let status;
    await handleAccountRoutes({ req: { method: "GET" }, url: new URL("https://example.com/api/points-ledger?" + query), state: createSeed(), user: { id: "alice" }, send: (res, code) => { status = code; } });
    assert.equal(status, 400, query);
  }
});

test("points page clears stale rows on filter failure, account switch and logout", async () => {
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token" };
  const pending = [];
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/points/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ request: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) }),
    wx: { getStorageSync: key => storage[key] }
  });
  page.setData = (value, callback) => { Object.assign(page.data, value); callback?.(); };
  const first = page.load();
  pending[0].resolve({ rows: [{ id: "old", changeType: "task_reward" }], total: 21, count: 20 });
  pending[1].resolve({ points: 100 });
  await first;
  assert.equal(page.data.balance, 100);
  const failed = page.load();
  assert.equal(page.data.ledger.length, 0);
  assert.equal(page.data.balance, null);
  pending[2].reject(new Error("offline")); pending[3].resolve({ points: 100 });
  await failed;
  assert.equal(page.data.hasMore, false);
  const old = page.load();
  storage.tgg_user = { id: "bob" };
  const current = page.load();
  pending[6].resolve({ rows: [{ id: "bob-row" }], total: 1, count: 20 }); pending[7].resolve({ points: 20 });
  await current;
  pending[4].resolve({ rows: [{ id: "alice-row" }], total: 1, count: 20 }); pending[5].resolve({ points: 100 });
  await old;
  assert.equal(page.data.ledger[0].id, "bob-row");
  assert.equal(page.data.balance, 20);
  delete storage.tgg_token; delete storage.tgg_user;
  await page.load();
  assert.equal(page.data.ledger.length, 0);
  assert.equal(page.data.balance, null);
  assert.equal(page.data.error, "请登录后查看积分流水");
});
