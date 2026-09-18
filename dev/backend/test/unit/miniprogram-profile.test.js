const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function setup(name = "me") {
  let page, cleared = 0;
  const pending = [], storage = new Map([["tgg_user", { id: "alice", points: 100 }], ["tgg_token", "token"]]);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../../../wechat-miniprogram/pages/${name}/index.js`), "utf8"), {
    Page: value => { page = value; },
    require: () => ({ request: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })), clearSession: () => { cleared++; storage.clear(); } }),
    wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), reLaunch() {} }
  });
  page.setData = values => Object.assign(page.data, values);
  return { page, pending, storage, cleared: () => cleared };
}

test("profile ignores stale reloads and clears previously displayed balance on failure", async () => {
  const { page, pending, storage } = setup();
  const old = page.load(), current = page.load();
  pending[1].resolve({ id: "alice", points: 200 }); await current;
  pending[0].resolve({ id: "alice", points: 100 }); await old;
  assert.equal(page.data.user.points, 200); assert.equal(storage.get("tgg_user").points, 200);
  const failure = page.load();
  assert.equal(page.data.user.id, undefined);
  pending[2].reject(new Error("offline")); await failure;
  assert.equal(page.data.user.points, undefined); assert.equal(page.data.error, "offline");
  assert.equal(page.data.loading, false);
});

test("profile cannot overwrite storage after account switch or unload", async () => {
  for (const unload of [false, true]) {
    const { page, pending, storage } = setup();
    const load = page.load();
    if (unload) page.onUnload(); else storage.set("tgg_user", { id: "bob" });
    pending[0].resolve({ id: "alice", points: 200 }); await load;
    assert.equal(page.data.user.id, undefined);
    assert.equal(storage.get("tgg_user").points, unload ? 100 : undefined);
  }
});

test("logout locks duplicate clicks and invalidates in-flight profile responses", async () => {
  const h = setup(); const load = h.page.load();
  const logout = h.page.logout(); await h.page.logout();
  assert.equal(h.pending.length, 2);
  h.pending[0].resolve({ id: "alice", points: 999 }); await load;
  assert.equal(h.page.data.user.id, undefined);
  h.pending[1].resolve({ ok: true }); await logout;
  assert.equal(h.cleared(), 1); assert.equal(h.page.data.loggedIn, false);
});

test("old logout completion does not clear a different account", async () => {
  const h = setup(); const logout = h.page.logout();
  h.storage.set("tgg_user", { id: "bob" });
  h.pending[0].resolve({ ok: true }); await logout;
  assert.equal(h.cleared(), 0); assert.equal(h.storage.get("tgg_user").id, "bob");
});

test("home ignores old requests and clears recommendations before failed reload", async () => {
  const h = setup("home"); const old = h.page.load(), current = h.page.load();
  h.pending[1].resolve({ recommendProducts: [{ id: "new", name: "新商品" }] }); await current;
  h.pending[0].resolve({ recommendProducts: [{ id: "old", name: "旧商品" }] }); await old;
  assert.equal(h.page.data.home.recommendProducts[0].id, "new");
  const failure = h.page.load(); h.pending[2].reject(new Error("offline")); await failure;
  assert.equal(h.page.data.home.recommendProducts.length, 0);
  assert.equal(h.page.data.error, "offline");
});
