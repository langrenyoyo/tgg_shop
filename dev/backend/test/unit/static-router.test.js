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

test("static routes reject encoded and plain path traversal", () => {
  let response;
  const res = {
    writeHead(status, headers) { response = { status, headers }; },
    end(body) { response.body = body.toString(); }
  };

  assert.equal(routeStatic({}, res, new URL("http://localhost/assets/../../dev/backend/.env")), false);
  assert.equal(routeStatic({}, res, new URL("http://localhost/assets/%252e%252e/%252e%252e/dev/backend/.env")), true);
  assert.equal(response.status, 404);
});

test("authorization bridge resources disable caching, referrers and external scripts", () => {
  for (const resource of ["withdrawal-authorization.html", "withdrawal-authorization.js"]) {
    let response;
    const res = {
      writeHead(status, headers) { response = { status, headers }; },
      end(body) { response.body = body.toString(); }
    };
    assert.equal(routeStatic({}, res, new URL(`https://example.test/user/${resource}`)), true);
    assert.equal(response.status, 200);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(response.headers["Referrer-Policy"], "no-referrer");
    assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
    assert.match(response.headers["Content-Security-Policy"], /script-src 'self'/);
    assert.match(response.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  }
});
