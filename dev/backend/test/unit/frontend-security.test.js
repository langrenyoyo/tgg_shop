const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../../../frontend/user/js/render.js"), "utf8");
const adminSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/admin/js/render.js"), "utf8");

test("task content does not insert provider image URLs without the safe URL guard", () => {
  assert.match(source, /<img src=\"\$\{safeImageUrl\(src\)\}/);
  assert.doesNotMatch(source, /<img src=\"\$\{src\}/);
});

test("task field names and labels are escaped before entering HTML attributes", () => {
  assert.match(source, /name=\"\$\{homeEscape\(field === \"phone\"/);
  assert.match(source, /placeholder=\"\$\{homeEscape\(label\)\}/);
  assert.match(source, /textarea name=\"\$\{homeEscape\(field\)\}/);
});

test("user order and payment fields are escaped before entering HTML", () => {
  assert.match(source, /data-order-open="\$\{homeEscape\(order\.id\)\}"/);
  assert.match(source, /homeEscape\(payment\.payNo \|\| payment\.id\)/);
  assert.match(source, /homeEscape\(order\.pickupCode \|\| "支付后生成"\)/);
});

test("admin tables escape ordinary cells and explicitly mark trusted controls", () => {
  assert.match(adminSource, /cell && cell\.__trustedHtml \? cell\.value : escapeHtml\(cell\)/);
  assert.match(adminSource, /function trustedHtml\(value\)/);
  assert.match(adminSource, /return trustedHtml\(`<span class="status/);
});

test("admin address table uses the persisted address field names", () => {
  assert.match(adminSource, /item\.receiverName \|\| item\.name \|\| item\.contactName/);
  assert.match(adminSource, /item\.mobile \|\| item\.phone \|\| item\.contactPhone/);
  assert.match(adminSource, /item\.province, item\.city, item\.district, item\.detail \|\| item\.address/);
});
