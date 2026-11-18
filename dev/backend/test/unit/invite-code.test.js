const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createInviteCodeService } = require("../../src/services/invite-code-service");
const { checkRateLimit } = require("../../src/http/rate-limit");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1kAAAAASUVORK5CYII=", "base64");
const alice = () => ({ id: "alice", status: "active", inviteCode: "ABCDEF012345" });
const env = () => ({ WECHAT_APPID: "test-app", WECHAT_APPSECRET: "test-secret" });
function provider(responses = []) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.includes("stable_token")) return Response.json({ access_token: "private-token", expires_in: 7200 });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next || new Response(png);
  } };
}

test("official code uses own scene, published homepage, private credentials and bounded cache with request deduplication", async () => {
  const upstream = provider(); let now = 0;
  const get = createInviteCodeService({ env: env(), fetchImpl: upstream.fetchImpl, now: () => now });
  const [a, b] = await Promise.all([get(alice()), get(alice())]);
  assert.equal(a.status, 200); assert.deepEqual(a, b); assert.equal(upstream.calls.length, 2);
  assert.equal(a.body.imageBase64, png.toString("base64")); assert.equal(a.body.userId, "alice");
  assert.equal(a.body.mimeType, "image/png"); assert.doesNotMatch(JSON.stringify(a), /test-secret|private-token/);
  assert.deepEqual(upstream.calls[0].body, { grant_type: "client_credential", appid: "test-app", secret: "test-secret", force_refresh: false });
  assert.equal(upstream.calls[1].body.scene, alice().inviteCode);
  assert.equal(upstream.calls[1].body.page, "pages/home/index");
  assert.equal(upstream.calls[1].body.check_path, true); assert.equal(upstream.calls[1].body.env_version, "release");
  await get(alice()); assert.equal(upstream.calls.length, 2);
  const bob = { ...alice(), id: "bob", inviteCode: "B-CODE" };
  assert.equal((await get(bob)).body.inviteCode, "B-CODE"); assert.equal(upstream.calls.length, 3);
  now = 86400001; await get(alice()); assert.equal(upstream.calls.length, 5);
});

test("expired WeChat token refreshes once; failures never leak upstream responses and are retryable", async () => {
  for (const code of [40001, 40014, 42001]) {
    const upstream = provider([Response.json({ errcode: code }), new Response(png)]);
    const result = await createInviteCodeService({ env: env(), fetchImpl: upstream.fetchImpl })(alice());
    assert.equal(result.status, 200); assert.equal(upstream.calls.length, 4);
  }
  for (const failure of [Response.json({ errcode: 41030 }), Response.json({ errcode: 45009 }), Response.json({ errcode: 999, errmsg: "private-token" }), new Response("not-image"), new Error("private-token"), new Response(Buffer.concat([png, Buffer.alloc(1024 * 1024)]))]) {
    const upstream = provider([failure]);
    const get = createInviteCodeService({ env: env(), fetchImpl: upstream.fetchImpl });
    const result = await get(alice());
    assert.equal(result.status, 502); assert.doesNotMatch(JSON.stringify(result), /private-token/);
    assert.equal((await get(alice())).status, 200);
  }
  const upstream = provider([Response.json({ errcode: 40001 }), Response.json({ errcode: 40001 })]);
  assert.equal((await createInviteCodeService({ env: env(), fetchImpl: upstream.fetchImpl })(alice())).status, 502);
  assert.equal(upstream.calls.length, 4);
});

test("configuration, disabled users and changed invitation ownership fail closed", async () => {
  const upstream = provider(), config = env();
  const get = createInviteCodeService({ env: config, fetchImpl: upstream.fetchImpl });
  assert.equal((await get(null)).status, 401);
  assert.equal((await get({ ...alice(), status: "disabled" })).status, 401);
  assert.equal((await get({ ...alice(), inviteCode: "x".repeat(33) })).status, 409);
  config.WECHAT_INVITE_CODE_ENV = "other";
  assert.equal((await get(alice())).status, 503); assert.equal(upstream.calls.length, 0);
  config.WECHAT_INVITE_CODE_ENV = "trial";
  await get(alice()); assert.equal(upstream.calls[1].body.env_version, "trial");
  delete config.WECHAT_APPSECRET; assert.equal((await get(alice())).status, 503);
  let finish;
  const slow = createInviteCodeService({ env: env(), fetchImpl: (url) => url.includes("stable_token") ? Promise.resolve(Response.json({ access_token: "t" })) : new Promise(resolve => { finish = resolve; }) });
  const user = alice(), work = slow(user); await new Promise(setImmediate);
  user.status = "disabled"; finish(new Response(png)); assert.equal((await work).status, 409);
});

test("code endpoint has its own rate limit", () => {
  const req = { method: "GET", socket: { remoteAddress: "invite-code-test" } }, url = new URL("https://test/api/invite/code");
  for (let i = 0; i < 10; i++) assert.equal(checkRateLimit(req, url, 1).ok, true);
  assert.equal(checkRateLimit(req, url, 2).status, 429);
  assert.equal(checkRateLimit(req, url, 60002).ok, true);
});

function mini() {
  let page; const storage = { tgg_user: { id: "alice" }, tgg_token: "t" }, pending = [], removed = [], saved = [];
  const wx = { getStorageSync: key => storage[key], env: { USER_DATA_PATH: "/local" }, showToast() {},
    getFileSystemManager: () => ({ writeFile: options => options.success(), unlink: options => removed.push(options.filePath) }),
    saveImageToPhotosAlbum: options => { saved.push(options.filePath); options.success(); }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/invite/index.js"), "utf8"), {
    wx, Page: value => { page = value; }, require: () => ({ request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  });
  page.setData = data => Object.assign(page.data, data); page.ownerId = "alice"; page.data.info = { inviteCode: alice().inviteCode };
  const result = { userId: "alice", inviteCode: alice().inviteCode, mimeType: "image/png", imageBase64: png.toString("base64") };
  return { page, wx, storage, pending, removed, saved, result };
}

test("mini page generates, saves, handles permission denial, retries and deletes local images on unload", async () => {
  const { page, wx, pending, result, saved, removed } = mini();
  const work = page.generateCode(); await page.generateCode(); assert.equal(pending.length, 1);
  pending[0].resolve(result); await work; assert.match(page.data.codePath, /^\/local\/invite-.*\.png$/);
  const file = page.data.codePath;
  await page.saveCode(); assert.deepEqual(saved, [file]);
  wx.saveImageToPhotosAlbum = options => options.fail({ errMsg: "saveImageToPhotosAlbum:fail auth deny" });
  await page.saveCode(); assert.equal(page.data.albumDenied, true); assert.equal(page.data.saving, false);
  wx.saveImageToPhotosAlbum = options => options.fail({ errMsg: "cancel" });
  await page.saveCode(); assert.match(page.data.codeError, /取消/);
  page.onUnload(); assert.equal(page.data.codePath, ""); assert.deepEqual(removed, [file]);
});

test("mini page rejects mismatched owners and stale responses after account changes, hiding or unloading", async () => {
  for (const change of [m => { m.storage.tgg_user = { id: "bob" }; }, m => m.page.onHide(), m => m.page.onUnload()]) {
    const m = mini(), work = m.page.generateCode(); change(m); m.pending[0].resolve(m.result); await work;
    assert.equal(m.page.data.codePath, ""); assert.equal(m.saved.length, 0);
  }
  const m = mini(); let work = m.page.generateCode(); m.pending[0].resolve({ ...m.result, userId: "bob" }); await work;
  assert.match(m.page.data.codeError, /异常/); assert.equal(m.page.data.generating, false);
  work = m.page.generateCode(); m.pending[1].reject(new Error("暂不可用")); await work;
  assert.equal(m.page.data.codeError, "暂不可用");
  work = m.page.generateCode(); m.pending[2].resolve(m.result); await work;
  m.storage.tgg_user = { id: "bob" }; await m.page.saveCode(); assert.equal(m.saved.length, 0); assert.equal(m.page.data.codePath, "");
  m.pending[3].resolve({ inviteCode: "B" }); m.pending[4].resolve({ rows: [], count: 20, total: 0 });
  await new Promise(setImmediate);
});

test("mini page cleans files if unloaded while writing, and reports filesystem errors", async () => {
  const m = mini(); let finish;
  m.wx.getFileSystemManager = () => ({ writeFile: options => { finish = options.success; }, unlink: options => m.removed.push(options.filePath) });
  let work = m.page.generateCode(); m.pending[0].resolve(m.result); await new Promise(setImmediate);
  m.page.onUnload(); finish(); await work; assert.equal(m.page.data.codePath, ""); assert.equal(m.removed.length, 1);
  const n = mini(); n.wx.getFileSystemManager = () => ({ writeFile: options => options.fail({ errMsg: "disk full" }), unlink() {} });
  work = n.page.generateCode(); n.pending[0].resolve(n.result); await work;
  assert.match(n.page.data.codeError, /保存失败/); assert.equal(n.page.data.generating, false);
});
