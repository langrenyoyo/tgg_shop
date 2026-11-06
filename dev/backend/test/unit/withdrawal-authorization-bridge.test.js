const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../../../frontend/user/withdrawal-authorization.js"), "utf8");
const scheme = "weixin://dl/business/?t=test_ticket";

function setup(ticket, options = {}) {
  const message = { textContent: "" };
  const listeners = {};
  const button = { disabled: true, addEventListener: (event, fn) => { listeners[event] = fn; } };
  const opened = [];
  const history = [];
  let now = 100000;
  const location = { pathname: "/user/withdrawal-authorization.html",
    hash: options.hash ?? `#${encodeURIComponent(JSON.stringify(ticket))}`,
    assign: value => { if (options.openError) throw new Error("Blocked"); opened.push(value); }
  };
  vm.runInNewContext(source, {
    document: { getElementById: id => id === "status" ? message : button },
    window: { location, history: { replaceState: (...args) => { history.push(args); location.hash = ""; } } },
    navigator: { userAgent: options.userAgent || "Android Chrome" },
    Date: { now: () => now }
  });
  return { button, message, opened, history, location, click: () => listeners.click?.(), time: value => { now = value; } };
}

test("bridge opens only after a click and removes the authorization ticket from history", () => {
  const f = setup({ scheme, expireTime: -1 });
  assert.equal(f.button.disabled, false);
  assert.equal(f.opened.length, 0);
  assert.equal(f.location.hash, "");
  assert.equal(f.history[0][2], "/user/withdrawal-authorization.html");
  f.click();
  assert.deepEqual(f.opened, [scheme]);
  assert.doesNotMatch(f.message.textContent, /授权成功|已授权/);
});

test("bridge rejects malformed tickets, expired links and substituted destinations", () => {
  for (const ticket of [null, {}, { scheme: "javascript:alert(1)", expireTime: -1 },
    { scheme: "https://example.test", expireTime: -1 }, { scheme: scheme + "&redirect=x", expireTime: -1 },
    { scheme, expireTime: 0 }, { scheme, expireTime: 99 }, { scheme, expireTime: "200" }]) {
    const f = setup(ticket);
    assert.equal(f.button.disabled, true);
    f.click();
    assert.equal(f.opened.length, 0);
  }
  assert.equal(setup(null, { hash: "#%XX" }).button.disabled, true);
});

test("bridge checks link expiry again when the user clicks", () => {
  const f = setup({ scheme, expireTime: 101 });
  assert.equal(f.button.disabled, false);
  f.time(101000); f.click();
  assert.equal(f.button.disabled, true);
  assert.equal(f.opened.length, 0);
});

test("WeChat browser directs the user to the system browser without opening the scheme", () => {
  const f = setup({ scheme, expireTime: -1 }, { userAgent: "MicroMessenger" });
  assert.equal(f.button.disabled, true);
  assert.match(f.message.textContent, /系统浏览器/);
  f.click();
  assert.equal(f.opened.length, 0);
});

test("browser rejection permits a retry without claiming authorization success", () => {
  const f = setup({ scheme, expireTime: -1 }, { openError: true });
  f.click();
  assert.equal(f.button.disabled, false);
  assert.equal(f.opened.length, 0);
  assert.match(f.message.textContent, /未能打开微信/);
});
