const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function setup() {
  const storage = { tgg_token: "token", tgg_user: { id: "alice" } };
  const pending = [], navigation = [], messages = [];
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/task-detail/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ request: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) }),
    wx: { getStorageSync: key => storage[key], navigateTo: value => navigation.push(value.url), showToast: value => messages.push(value.title) }
  });
  page.setData = value => Object.assign(page.data, value);
  page.onLoad({ id: "task/1" });
  return { page, storage, pending, navigation, messages };
}
async function ready(context) {
  const load = context.page.load(); context.pending.at(-1).resolve({ id: "task/1", paused: false, rewardPoints: 10 }); await load;
}
test("task membership network failure stays retryable and duplicate taps navigate only once", async () => {
  const context = setup(); await ready(context);
  const { page, pending, navigation, messages } = context;
  const failed = page.goSubmit(); pending[1].reject(new Error("offline")); await failed;
  assert.equal(navigation.length, 0); assert.equal(messages[0], "offline"); assert.equal(page.data.busy, false);
  const retry = page.goSubmit(); await page.goSubmit();
  assert.equal(pending.length, 3);
  pending[2].resolve({ isMember: true }); await retry;
  assert.deepEqual(navigation, ["/pages/task-submit/index?id=task%2F1"]);
});
test("task refresh suppresses stale results and in-flight membership checks cannot navigate for new account", async () => {
  const context = setup();
  const { page, pending, storage, navigation } = context;
  const old = page.load(), latest = page.load();
  pending[1].resolve({ paused: true }); await latest;
  pending[0].resolve({ paused: false }); await old;
  assert.equal(page.data.task.paused, true);
  await ready(context);
  const checking = page.goSubmit(); storage.tgg_user = { id: "bob" };
  pending.at(-1).resolve({ isMember: true }); await checking;
  assert.equal(navigation.length, 0);
});
test("expired login clearing local session opens login while nonmembers open membership", async () => {
  const context = setup(); await ready(context);
  const { page, pending, storage, navigation } = context;
  const expired = page.goSubmit(); delete storage.tgg_token; delete storage.tgg_user;
  pending[1].reject(Object.assign(new Error("expired"), { statusCode: 401 })); await expired;
  assert.equal(navigation.at(-1), "/pages/login/index");
  storage.tgg_token = "token"; storage.tgg_user = { id: "alice" };
  const nonmember = page.goSubmit(); pending[2].resolve({ isMember: false }); await nonmember;
  assert.equal(navigation.at(-1), "/pages/membership/index");
});
