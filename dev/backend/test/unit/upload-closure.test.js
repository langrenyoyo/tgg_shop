const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function uploadRoute() {
  const writes = [];
  const context = { module: { exports: {} }, __dirname, Buffer, require: name => name === "path" ? path : { mkdirSync() {}, writeFileSync: (file, data) => writes.push(data) } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../src/routes/common-routes.js"), "utf8"), context);
  return { route: context.module.exports.handleCommonRoutes, writes };
}

test("upload requires login before consuming body and rejects oversized requests", async () => {
  const { route, writes } = uploadRoute();
  let status;
  const ctx = { req: { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": 11 * 1024 * 1024 }, [Symbol.asyncIterator]() { assert.fail("Body should not be read"); } }, url: new URL("https://example.com/api/common/upload"), send: (res, code) => { status = code; } };
  await route(ctx);
  assert.equal(status, 401);
  await route({ ...ctx, user: { id: "alice" } });
  assert.equal(status, 413);
  assert.equal(writes.length, 0);
});

test("multipart quoted boundary preserves binary file including trailing CRLF", async () => {
  const { route, writes } = uploadRoute();
  const data = Buffer.from([0, 255, 13, 10]);
  const body = Buffer.concat([Buffer.from('--test\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\n'), data, Buffer.from('\r\n--test--\r\n')]);
  let status;
  await route({ user: { id: "alice" }, req: { method: "POST", headers: { "content-type": 'multipart/form-data; boundary="test"' }, async *[Symbol.asyncIterator]() { yield body; } }, url: new URL("https://example.com/api/common/upload"), send: (res, code) => { status = code; } });
  assert.equal(status, 200);
  assert.deepEqual(writes[0], data);
});

test("mini upload resolves relative screenshot paths to absolute URLs for task review", async () => {
  const context = { module: { exports: {} }, require: () => ({ develop: "https://shop.taoguoguo.cc" }), wx: { getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }), getStorageSync: () => null, uploadFile: options => options.success({ statusCode: 200, data: JSON.stringify({ code: 0, data: [{ path: "/uploads/proof.png" }] }) }) } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/utils/api.js"), "utf8"), context);
  const result = await context.module.exports.uploadFile("proof.png");
  assert.equal(result.path, "https://shop.taoguoguo.cc/uploads/proof.png");
  assert.equal(result.url, result.path);
});
