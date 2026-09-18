const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const storage = { tgg_user: { id: "a" }, tgg_token: "token" };
  const pending = [], navigation = [];
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/submission/index.js"), "utf8"), {
    Page(value) { page = value; },
    require() { return { request: (url, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, url, options })) }; },
    wx: {
      getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
      navigateTo: value => navigation.push(value.url), switchTab: value => navigation.push(value.url)
    }
  });
  page.setData = value => Object.assign(page.data, value);
  page.onLoad({ id: "submission1" });
  return { page, storage, pending, navigation };
}

test("submission detail rejects stale responses and clears another account's cached record", async () => {
  const { page, storage, pending } = setup();
  const old = page.load(), latest = page.load();
  pending[1].resolve({ id: "submission1", status: "rejected" });
  await latest;
  pending[0].resolve({ id: "submission1", status: "reviewing" });
  await old;
  assert.equal(page.data.submission.status, "rejected");
  const changing = page.load();
  storage.tgg_user = { id: "b" };
  pending[2].resolve({ id: "submission1", userId: "a" });
  await changing;
  assert.equal(page.data.submission, null);
  delete storage.tgg_token;
  await page.load();
  assert.equal(page.data.error, "请登录后查看提交记录");
  assert.equal(pending.length, 3);
});

test("rejected submissions provide task requirements and record navigation; failures clear stale data", async () => {
  const { page, pending, storage, navigation } = setup();
  const loading = page.load();
  pending[0].resolve({ id: "submission1", taskId: "task/1", status: "rejected", remarks: "截图错误" });
  await loading;
  page.openTask(); page.openRecords();
  assert.deepEqual(navigation, ["/pages/task-detail/index?id=task%2F1", "/pages/tasks/index"]);
  assert.equal(storage.tgg_task_view, "submissions");
  const failed = page.load();
  pending[1].reject(new Error("记录不存在"));
  await failed;
  assert.equal(page.data.submission, null);
  assert.equal(page.data.error, "记录不存在");
  assert.equal(page.data.loading, false);
});

test("platform refresh explicitly synchronizes and preserves a retry path after provider failure", async () => {
  const { page, pending } = setup();
  const first = page.load();
  pending[0].resolve({ id: "submission1", platform: "bounty_platform", status: "reviewing" });
  await first;
  const refresh = page.refresh();
  assert.equal(pending[1].url, "/api/submissions/submission1/sync");
  assert.equal(pending[1].options.method, "POST");
  pending[1].reject(new Error("平台暂未查到审核单"));
  await refresh;
  assert.equal(page.data.submission.status, "reviewing");
  assert.equal(page.data.error, "平台暂未查到审核单");
  const retry = page.refresh();
  assert.equal(pending[2].options.method, "POST");
  pending[2].resolve({ id: "submission1", platform: "bounty_platform", status: "approved" });
  await retry;
  assert.equal(page.data.submission.status, "approved");
  assert.equal(page.data.error, "");
});
