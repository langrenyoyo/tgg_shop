const test = require("node:test");
const assert = require("node:assert/strict");
const source = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../server.js"), "utf8");

test("server preserves sanitized provider statuses and hides unclassified internal errors", () => {
  assert.match(source, /error\?\.status \|\| error\?\.statusCode/);
  assert.match(source, /safeStatus === 500 \? "服务器暂时无法处理请求"/);
  assert.doesNotMatch(source, /send\(res, 500, \{ error: error\.message \}\)/);
});
