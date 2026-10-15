const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup({ bindError, wxError, logoutError } = {}) {
  let page, session = null;
  const calls = [], redirects = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/station-login/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: () => ({
      saveStationSession: result => { session = result; },
      clearStationSession: () => { session = null; },
      request: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/bind-wechat") && bindError) throw bindError;
        if (url.endsWith("/logout") && logoutError) throw logoutError;
        return { token: "temporary-token", refreshToken: "temporary-refresh", station: { id: "worker" } };
      }
    }),
    wx: {
      login: options => wxError ? options.fail(wxError) : options.success({ code: "wx-code" }),
      reLaunch: options => redirects.push(options.url)
    }
  });
  page.setData = values => Object.assign(page.data, values);
  page.setData({ username: "worker", password: "test-password" });
  return { page, calls, redirects, session: () => session };
}

for (const statusCode of [400, 409, 503]) {
  test(`failed station WeChat binding (${statusCode}) revokes and clears temporary login`, async () => {
    const h = setup({ bindError: Object.assign(new Error("bind failed"), { statusCode }) });
    await h.page.bindWechat();
    assert.equal(h.session(), null);
    assert.equal(h.calls.filter(call => call.url.endsWith("/logout")).length, 1);
    assert.equal(h.page.data.error, "bind failed");
    assert.equal(h.page.data.binding, false);
    assert.equal(h.redirects.length, 0);
  });
}

test("failed WeChat code retrieval leaves no station session even if logout fails", async () => {
  const h = setup({ wxError: new Error("wx unavailable"), logoutError: new Error("offline") });
  await h.page.bindWechat();
  assert.equal(h.session(), null);
  assert.equal(h.page.data.error, "wx unavailable");
  assert.equal(h.redirects.length, 0);
});

test("successful station binding retains the new session and enters the workbench", async () => {
  const h = setup();
  await h.page.bindWechat();
  assert.equal(h.session().station.id, "worker");
  assert.deepEqual(h.redirects, ["/pages/station/index"]);
  assert.equal(h.calls.some(call => call.url.endsWith("/logout")), false);
});
