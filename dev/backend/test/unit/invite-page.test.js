process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSeed } = require("../../src/data/seed");
const { listInviteUsers, getInviteInfo } = require("../../src/services/growth-service");
const { handleGrowthRoutes } = require("../../src/routes/growth-routes");

test("invite pagination preserves contribution attribution and full totals", () => {
  const state = createSeed(), user = state.users[0];
  state.inviteRelations = [{ inviterUserId: user.id, inviteeUserId: "a", boundAt: "2026-01-01" }, { inviterUserId: user.id, inviteeUserId: "b", boundAt: "2026-01-02" }, { inviterUserId: "other", inviteeUserId: "c" }];
  state.submissions = [{ id: "sa", userId: "a" }, { id: "sb", userId: "b" }];
  state.pointLedger = [{ userId: user.id, bizNo: "sa", changeType: "invite_commission", points: 4 }, { userId: user.id, bizNo: "sb", changeType: "invite_commission", points: 7 }, { userId: "other", bizNo: "sb", changeType: "invite_commission", points: 99 }];
  const first = listInviteUsers(state, user, { page: "1", count: "1" });
  assert.equal(first.rows[0].uid, "b"); assert.equal(first.rows[0].contributed, 7); assert.equal(first.total, 2);
  assert.equal(listInviteUsers(state, user, { page: "2", count: "1" }).rows[0].contributed, 4);
  assert.equal(listInviteUsers(state, user).length, 2);
  assert.equal(getInviteInfo(state, user).totalCommission, 11);
  assert.equal(getInviteInfo(state, user).totalInvited, 2);
});

test("invite endpoint rejects invalid pagination on both supported methods", async () => {
  for (const method of ["GET", "POST"]) for (const query of ["page=0", "count=101", "page=bad", "page=1.2"]) {
    let status;
    await handleGrowthRoutes({ req: { method }, url: new URL("https://example.com/api/invite/list?" + query), state: createSeed(), user: { id: "alice" }, send: (res, code) => { status = code; } });
    assert.equal(status, 400);
  }
});

test("invite page paginates, retries failures, and never shares or copies a previous account's code", async () => {
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token" }, pending = [], copied = [];
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/invite/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ request: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) }),
    wx: { getStorageSync: key => storage[key], setClipboardData: value => copied.push(value.data) }
  });
  page.setData = value => Object.assign(page.data, value);
  const first = page.load();
  pending[0].resolve({ inviteCode: "A" }); pending[1].resolve({ rows: [{ uid: "first" }], total: 21, count: 20 });
  await first;
  assert.equal(page.onShareAppMessage().path, "/pages/home/index?inviteCode=A");
  page.copyCode(); assert.deepEqual(copied, ["A"]);
  const next = page.load(true);
  assert.match(pending[3].url, /page=2/);
  pending[2].resolve({ inviteCode: "A" }); pending[3].resolve({ rows: [{ uid: "second" }], total: 21, count: 20 });
  await next;
  assert.equal(page.data.list.length, 2); assert.equal(page.data.hasMore, false);
  storage.tgg_user = { id: "bob" };
  assert.equal(page.onShareAppMessage().path, "/pages/home/index");
  page.copyCode();
  assert.deepEqual(copied, ["A"]);
  assert.equal(page.data.info, null); assert.equal(page.data.list.length, 0);
  pending[4].reject(new Error("offline")); pending[5].resolve({ rows: [], total: 0, count: 20 });
  await new Promise(setImmediate);
  assert.equal(page.data.error, "offline");
  const retry = page.load();
  pending[6].resolve({ inviteCode: "B" }); pending[7].resolve({ rows: [], total: 0, count: 20 });
  await retry;
  assert.equal(page.onShareAppMessage().path, "/pages/home/index?inviteCode=B");
  delete storage.tgg_token;
  await page.load();
  assert.equal(page.data.info, null); assert.equal(page.data.error, "请登录后查看邀请记录");
});
