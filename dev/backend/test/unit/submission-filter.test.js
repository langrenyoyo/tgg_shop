process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const platform = require("../../src/services/task-platform-client");
const { listUserSubmissions } = require("../../src/services/task-service");
const { handleTaskRoutes } = require("../../src/routes/task-routes");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("mini submission filters restart at page one and short remote pages remain pageable", async () => {
  let page;
  const urls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/tasks/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ request: async url => {
      urls.push(url);
      return urls.length === 1 ? [{ id: "found", status: "rejected" }] : [];
    } })
  });
  page.setData = (data, callback) => { Object.assign(page.data, data); callback?.(); };
  Object.assign(page.data, { activeTab: "submissions", page: 4, submissions: [{ id: "old", status: "approved" }] });
  page.filterRecords({ currentTarget: { dataset: { id: "rejected" } } });
  await new Promise(setImmediate);
  assert.equal(urls[0], "/api/submissions?page=1&status=rejected");
  assert.equal(page.data.visibleSubmissions[0].id, "found");
  assert.equal(page.data.visibleSubmissions.length, 1);
  assert.equal(page.data.hasMore, true);
  page.loadMore();
  await new Promise(setImmediate);
  assert.equal(urls[1], "/api/submissions?page=2&status=rejected");
  assert.equal(page.data.hasMore, false);
});

test("submission status is filtered before local pagination", async t => {
  t.mock.method(platform, "isConfigured", () => false);
  const state = createSeed();
  state.submissions = Array.from({ length: 35 }, (_, i) => ({ id: String(i), userId: "alice", status: i < 20 ? "approved" : "rejected" }));
  state.submissions.unshift({ id: "foreign", userId: "bob", status: "rejected" });
  const first = await listUserSubmissions(state, "alice", { page: "1", status: "rejected" });
  const second = await listUserSubmissions(state, "alice", { page: "2", status: "2" });
  assert.equal(first.length, 10);
  assert.equal(first[0].id, "20");
  assert.equal(second.length, 5);
  assert.equal(second[0].id, "30");
  assert.equal((await listUserSubmissions(state, "alice", { page: "3", status: "rejected" })).length, 0);
});

test("platform receives documented numeric status and unrelated local pending rows stay out", async t => {
  t.mock.method(platform, "isConfigured", () => true);
  const requests = [];
  t.mock.method(platform, "post", async (endpoint, data) => {
    requests.push(data);
    return [];
  });
  const state = createSeed();
  state.submissions = [{ id: "pending", userId: "alice", status: "reviewing", platform: "bounty_platform", externalOrderId: null }];
  assert.equal((await listUserSubmissions(state, "alice", { page: 1, status: "rejected" })).length, 0);
  assert.equal(requests[0].status, "2");
  assert.equal(requests[0].sf_uid, "alice");
  assert.equal((await listUserSubmissions(state, "alice", { page: 1, status: "reviewing" })).length, 1);
  assert.equal(requests[1].status, "0");
  assert.equal((await listUserSubmissions(state, "alice", { page: 2, status: "reviewing" })).length, 0);
});

test("invalid submission filters fail without querying the provider", async t => {
  t.mock.method(platform, "post", () => assert.fail("Invalid filter must not reach provider"));
  for (const query of ["status=unknown", "page=-1", "page=1.5", "page=0", "page=bad"]) {
    let status;
    await handleTaskRoutes({ req: { method: "GET" }, url: new URL("https://example.com/api/submissions?" + query), state: createSeed(), user: { id: "alice" }, send: (res, code) => { status = code; } });
    assert.equal(status, 400);
  }
});
