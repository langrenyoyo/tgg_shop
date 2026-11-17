const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
process.env.TGG_STORE_MODE = "memory";
const { getMemberCode } = require("../../src/services/member-code-service");
const barcode = require("../../../../wechat-miniprogram/utils/member-barcode");

test("POS code preserves exact card number and never invents an association", () => {
  const user = { id: "u1", pospalUid: "pos1", pospalNumber: "0012345678" };
  const state = { users: [user], config: {} };
  assert.deepEqual(getMemberCode(state, user).body, { available: true, userId: "u1", number: "0012345678", format: "CODE128" });
  assert.equal(getMemberCode(state, null).status, 401);
  for (const number of [undefined, "", 1234, "a\nb", "会员123", "a".repeat(33)]) {
    assert.equal(getMemberCode(state, { ...user, pospalNumber: number }).body.available, false);
  }
  state.users.push({ id: "u2", pospalUid: "other", pospalNumber: user.pospalNumber });
  assert.equal(getMemberCode(state, user).body.available, false);
  state.users.pop();
  state.config.pospalIntegration = { customerMappings: [{ tggUserId: user.id, pospalUid: "old", number: "old" }] };
  assert.equal(getMemberCode(state, user).body.available, false);
});

test("member code endpoint requires auth and ignores requested user IDs", async () => {
  const { resetState } = require("../../src/data/store");
  const { routeApi } = require("../../src/routes/api-router");
  const state = resetState(), user = state.users[0];
  Object.assign(user, { pospalUid: "code-test", pospalNumber: "00123456", passwordHash: require("../../src/domain/admin-accounts").hashAdminPassword("123456") });
  const session = require("../../src/services/auth-service").login(state, { userId: user.id, password: "123456" });
  assert.equal(session.ok, true);
  let status, body, headers;
  const res = { writeHead(s, h) { status = s; headers = h; }, end(v) { body = JSON.parse(v); } };
  const url = new URL("http://localhost/api/me/member-code?userId=someone-else");
  await routeApi({ method: "GET", headers: {} }, res, url);
  assert.equal(status, 401);
  await routeApi({ method: "POST", headers: {}, async *[Symbol.asyncIterator]() { throw new Error("must authenticate before reading body"); } }, res, url);
  assert.equal(status, 401);
  await routeApi({ method: "GET", headers: { authorization: `Bearer ${session.token}` } }, res, url);
  assert.equal(status, 200); assert.equal(body.userId, user.id); assert.equal(body.number, "00123456");
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(body.pospalUid, undefined);
});

test("active membership without POS identity gives association guidance, not a purchase prompt", () => {
  const user = { id: "u1", memberUntil: new Date(Date.now() + 86400000).toISOString() };
  const state = { users: [user], config: {} };
  let result = getMemberCode(state, user).body;
  assert.equal(result.available, false);
  assert.equal(result.isMember, true);
  assert.equal(result.reason, "provision_required");
  assert.equal(result.needsPhoneAuthorization, true);
  assert.match(result.message, /无需再次付费/);
  user.phone = "13800000000";
  result = getMemberCode(state, user).body;
  assert.equal(result.reason, "provision_required");
  user.memberUntil = "2000-01-01";
  assert.equal(getMemberCode(state, user).body.isMember, false);
});

test("existing owner mapping supplies missing mirrored fields without guessing from a phone", () => {
  const user = { id: "u1", phone: "13800000000" };
  const mapping = { tggUserId: "u1", pospalUid: "p1", number: "000123" };
  const state = { users: [user], config: { pospalIntegration: { customerMappings: [mapping] } } };
  const before = JSON.stringify(state);
  assert.equal(getMemberCode(state, user).body.number, "000123");
  assert.equal(JSON.stringify(state), before);
  user.pospalUid = "different";
  assert.equal(getMemberCode(state, user).body.reason, "association_conflict");
  delete user.pospalUid;
  state.config.pospalIntegration.customerMappings.push({ ...mapping });
  assert.equal(getMemberCode(state, user).body.reason, "association_conflict");
  state.config.pospalIntegration.customerMappings = [{ ...mapping, tggUserId: "other", phone: user.phone }];
  assert.equal(getMemberCode(state, user).body.available, false);
});

test("barcode drawing retains quiet zones and uses integer physical pixels", () => {
  for (const number of ["001234567890", "VIP-001", "12345678901"]) {
    const rectangles = [];
    const ctx = { fillRect(...args) { rectangles.push({ color: this.fillStyle, args }); } };
    const canvas = { getContext: () => ctx };
    barcode.draw(canvas, number, 300, 120, 3);
    const bits = barcode.encode(number), moduleWidth = Math.floor(900 / (bits.length + 20));
    const bars = rectangles.filter(r => r.color === "#000000");
    assert.ok(bars[0].args[0] >= 10 * moduleWidth);
    assert.ok(900 - bars.at(-1).args[0] - moduleWidth >= 10 * moduleWidth);
    assert.ok(bars.every(r => r.args.every(Number.isInteger)));
  }
  assert.throws(() => barcode.encode("abc\n"));
  assert.throws(() => barcode.draw({ getContext() {} }, "A".repeat(32), 300, 120, 1), /卡号较长/);
});

function setup() {
  let page;
  const requests = [], storage = new Map([["tgg_user", { id: "alice" }], ["tgg_token", "token"]]);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/member-code/index.js"), "utf8"), {
    Page(value) { page = value; },
    require: name => name.includes("member-barcode") ? barcode : { request: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) },
    wx: { getStorageSync: key => storage.get(key) }
  });
  page.setData = values => Object.assign(page.data, values);
  page.visible = true;
  return { page, requests, storage };
}
test("member-code page clears on hide and discards stale or switched-account responses", async () => {
  for (const action of ["hide", "switch", "reload"]) {
    const h = setup(), first = h.page.load();
    if (action === "hide") h.page.onHide();
    if (action === "switch") h.storage.set("tgg_user", { id: "bob" });
    if (action === "reload") { const next = h.page.load(); h.requests[1].resolve({ available: false, message: "未关联" }); await next; }
    h.requests[0].resolve({ available: true, userId: "alice", number: "00123", format: "CODE128" });
    await first;
    assert.equal(h.page.data.number, "");
  }
});
test("member-code page handles missing associations, failures and anonymous sessions", async () => {
  const h = setup(), load = h.page.load();
  h.requests[0].resolve({ available: false, message: "未关联" }); await load;
  assert.equal(h.page.data.message, "未关联");
  const failure = h.page.load(); h.requests[1].reject(new Error("offline")); await failure;
  assert.equal(h.page.data.error, "offline"); assert.equal(h.page.data.number, "");
  h.storage.clear(); await h.page.load();
  assert.equal(h.page.data.loggedIn, false); assert.equal(h.requests.length, 2);
});

test("member-code page explains an undeployed backend endpoint", async () => {
  const h = setup(), load = h.page.load();
  h.requests[0].reject(Object.assign(new Error("API not found"), { statusCode: 404 }));
  await load;
  assert.match(h.page.data.error, /服务尚未上线/);
  assert.equal(h.page.data.number, "");
});

test("member phone authorization explains missing privacy declaration without submitting", () => {
  const h = setup();
  h.page.authorizePhone({ detail: { errno: 112 } });
  assert.match(h.page.data.error, /声明尚未生效/);
  assert.equal(h.requests.length, 0);
});

test("page requests phone consent once, then provisions with the returned code", async () => {
  const h = setup(); const load = h.page.load();
  h.requests[0].resolve({ available: false, canProvision: true, needsPhoneAuthorization: true, message: "请授权" });
  await load;
  assert.equal(h.page.data.needsPhoneAuthorization, true);
  h.page.authorizePhone({ detail: {} });
  assert.equal(h.requests.length, 1);
  const provision = h.page.authorizePhone({ detail: { code: "wx-code" } });
  h.requests[1].resolve({ available: false, canProvision: true, needsPhoneAuthorization: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[2].options.method, "POST");
  assert.equal(h.requests[2].options.data.phoneCode, "wx-code");
  h.requests[2].resolve({ available: true, userId: "alice", number: "00123", format: "CODE128" });
  await provision;
  assert.equal(h.page.data.number, "00123");
  assert.equal(h.page.data.needsPhoneAuthorization, false);
});

test("page resumes a verified pending attempt and hides results after account switch", async () => {
  const h = setup(); const load = h.page.load();
  h.requests[0].resolve({ available: false, canProvision: true, needsPhoneAuthorization: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[1].options.method, "POST");
  assert.equal(Object.keys(h.requests[1].options.data).length, 0);
  h.storage.set("tgg_user", { id: "bob" });
  h.requests[1].resolve({ available: true, userId: "alice", number: "00123", format: "CODE128" });
  await load;
  assert.equal(h.page.data.number, "");
});
