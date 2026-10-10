const test = require("node:test");
const assert = require("node:assert/strict");
const { routeStatic } = require("../../src/http/static-router");

test("admin login route serves the admin app shell", () => {
  let response;
  const res = {
    writeHead(status, headers) { response = { status, headers }; },
    end(body) { response.body = body.toString(); }
  };

  assert.equal(routeStatic({}, res, new URL("http://localhost/admin/login")), true);
  assert.equal(response.status, 200);
  assert.match(response.headers["Content-Type"], /^text\/html/);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.match(response.body, /TGG Shop Admin Dev/);
});
