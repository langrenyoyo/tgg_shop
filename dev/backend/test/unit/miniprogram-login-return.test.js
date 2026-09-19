const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const depth of [1, 2]) {
  test(`login returns to its origin or home at stack depth ${depth}`, async () => {
    let page;
    let destination;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/login/index.js"), "utf8"), {
      require: () => ({ wechatLogin: async () => ({ user: { id: "alice", nickname: "Alice", avatarUrl: "/uploads/avatar.png" } }), resolveAssetUrl: value => value }),
      Page: value => { page = value; },
      getCurrentPages: () => Array(depth).fill({}),
      wx: {
        navigateBack: options => { destination = options.delta; },
        reLaunch: options => { destination = options.url; },
        showToast() { assert.fail("Login should succeed"); }
      }
    });
    page.setData = value => Object.assign(page.data, value);
    page.setData({ agreed: true });
    await page.handleLogin();
    assert.equal(destination, depth === 1 ? "/pages/home/index" : 1);
    assert.equal(page.data.loading, false);
  });
}
