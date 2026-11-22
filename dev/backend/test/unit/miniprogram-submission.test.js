const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const storage = { tgg_user: { id: "a" }, tgg_token: "token" };
  const pending = [], navigation = [], previews = [], messages = [];
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/submission/index.js"), "utf8"), {
    Page(value) { page = value; },
    require() { return { request: (url, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, url, options })),
      resolveAssetUrl: value => /^https?:\/\//i.test(value) ? value : value.startsWith("//") ? "https:" + value : "https://shop.example/" + value.replace(/^\//, "") }; },
    wx: {
      getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
      navigateTo: value => navigation.push(value.url), switchTab: value => navigation.push(value.url),
      previewImage: value => previews.push(value), showToast: value => messages.push(value.title)
    }
  });
  page.setData = value => {
    for (const [key, item] of Object.entries(value)) {
      const match = key.match(/^proofImages\[(\d+)\]\.failed$/);
      if (match) page.data.proofImages[Number(match[1])].failed = item;
      else page.data[key] = item;
    }
  };
  page.onLoad({ id: "submission1" });
  return { page, storage, pending, navigation, previews, messages };
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

test("submission comma-separated screenshots resolve, deduplicate and preview the selected original in order", async () => {
  const { page, pending, previews } = setup();
  const loading = page.load();
  pending[0].resolve({ id: "submission1", payload: { images: "https://shop.example/uploads/one.jpg, /uploads/two.jpg,https://shop.example/uploads/one.jpg" } });
  await loading;
  assert.deepEqual(Array.from(page.data.proofImages, image => image.url), ["https://shop.example/uploads/one.jpg", "https://shop.example/uploads/two.jpg"]);
  page.previewProof({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(previews[0].current, "https://shop.example/uploads/two.jpg");
  assert.deepEqual(Array.from(previews[0].urls), Array.from(page.data.proofImages, image => image.url));
  const markup = fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/submission/index.wxml"), "utf8");
  assert.match(markup, /wx:for="\{\{proofImages\}\}"/); assert.match(markup, /bindtap="previewProof"/);
  assert.match(markup, /binderror="proofError"/);
});

test("remote normalized screenshot URLs take priority and unsafe inputs never reach image preview", async () => {
  const { page, pending, previews } = setup();
  for (const [field, images, expected] of [
    ["proofImages", ["https://platform.example/proof.png", "javascript:alert(1)", "data:image/png;base64,abc", null, "https://user:password@example.com/private.png"], ["https://platform.example/proof.png"]],
    ["payload", '["/uploads/one.png","//images.example/two.png"]', ["https://shop.example/uploads/one.png", "https://images.example/two.png"]],
    ["payload", null, []], ["payload", "[broken", []]
  ]) {
    const loading = page.load();
    pending.at(-1).resolve(field === "proofImages" ? { proofImages: images, payload: { images: "https://wrong.example/ignore.png" } } : { payload: { images } });
    await loading;
    assert.deepEqual(Array.from(page.data.proofImages, image => image.url), expected);
  }
  page.previewProof({ currentTarget: { dataset: { index: 0 } } }); assert.equal(previews.length, 0);
});

test("failed screenshots show fallback, retry original preview and remain available after sync failure", async () => {
  const { page, pending, previews, messages } = setup();
  const loading = page.load();
  pending[0].resolve({ platform: "bounty_platform", payload: { images: "https://shop.example/one.png" } }); await loading;
  page.proofError({ currentTarget: { dataset: { index: 0, url: "https://old.example/wrong.png" } } });
  assert.equal(page.data.proofImages[0].failed, false);
  page.proofError({ currentTarget: { dataset: { index: 0, url: "https://shop.example/one.png" } } });
  assert.equal(page.data.proofImages[0].failed, true);
  page.previewProof({ currentTarget: { dataset: { index: 0 } } }); previews[0].fail(); assert.equal(messages.length, 1);
  const refresh = page.refresh(); assert.equal(page.data.proofImages.length, 0);
  pending[1].reject(new Error("offline")); await refresh;
  assert.equal(page.data.proofImages[0].url, "https://shop.example/one.png");
  assert.equal(page.data.proofImages[0].failed, true);
});

test("account changes and unload block stale screenshots and preview; sync failure cannot restore a previous owner's evidence", async () => {
  const { page, storage, pending, previews } = setup();
  const loading = page.load(); pending[0].resolve({ platform: "bounty_platform", payload: { images: "https://shop.example/private.png" } }); await loading;
  storage.tgg_user = { id: "b" };
  page.previewProof({ currentTarget: { dataset: { index: 0 } } }); assert.equal(previews.length, 0);
  const changed = page.refresh(); pending[1].reject(new Error("not found")); await changed;
  assert.equal(page.data.submission, null); assert.equal(page.data.proofImages.length, 0);
  const stale = page.load(); page.onUnload();
  pending[2].resolve({ payload: { images: "https://shop.example/stale.png" } }); await stale;
  assert.equal(page.data.proofImages.length, 0);
});
