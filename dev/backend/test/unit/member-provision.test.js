const test = require("node:test");
const assert = require("node:assert/strict");
process.env.TGG_STORE_MODE = "memory";
const { provisionMember } = require("../../src/services/member-provision-service");
const { getMemberCode } = require("../../src/services/member-code-service");
const { exchangePhoneCode } = require("../../src/services/wechat-phone-service");

function setup() {
  const user = { id: "member-1", status: "active", memberUntil: new Date(Date.now() + 86400000).toISOString() };
  const state = { users: [user], config: {} }, customers = [], calls = [];
  let persisted;
  const deps = {
    save: async () => { calls.push("save"); persisted = structuredClone(state); },
    verifyPhone: async code => { calls.push("verify"); assert.equal(code, "wx-code"); return "13800000000"; },
    client: {
      config: { baseUrl: "https://example.test", appId: "app", appKey: "key", account: "store" },
      queryCustomers: async body => {
        calls.push("query");
        assert.ok(persisted.config.pospalIntegration.memberProvisions[user.id]);
        return { result: { list: customers.filter(row => (!body.number || row.number === body.number) && (!body.tel || row.tel === body.tel)), hasMore: false } };
      },
      addCustomer: async body => {
        calls.push("add");
        assert.equal(persisted.config.pospalIntegration.memberProvisions[user.id].status, "creating");
        assert.equal(body.validateTelUnique, true);
        assert.equal(body.point, undefined); assert.equal(body.discount, undefined);
        customers.push({ ...body, uid: "900000000000000001", enable: 1 });
        return { status: "success", result: customers.at(-1) };
      }
    }
  };
  return { state, user, customers, calls, deps, persisted: () => persisted };
}
test("verified phone creates one durable POS identity; concurrent calls and later reads reuse it", async () => {
  const h = setup();
  const [a, b] = await Promise.all([provisionMember(h.state, h.user, { phoneCode: "wx-code" }, h.deps), provisionMember(h.state, h.user, {}, h.deps)]);
  assert.equal(a.body.available, true); assert.deepEqual(a, b);
  assert.match(a.body.number, /^\d{28}$/);
  assert.equal(h.calls.filter(v => v === "add").length, 1);
  assert.equal(h.calls.filter(v => v === "verify").length, 1);
  assert.equal(h.persisted().users[0].pospalNumber, a.body.number);
  assert.equal((await provisionMember(h.state, h.user, {}, h.deps)).body.number, a.body.number);
  assert.equal(h.calls.filter(v => v === "add").length, 1);
});
test("existing unique active phone member is linked, retaining number and financial data", async () => {
  const h = setup();
  h.customers.push({ uid: "existing", number: "000123", tel: "13800000000", enable: 1, point: 99, balance: 88 });
  const result = await provisionMember(h.state, h.user, { phoneCode: "wx-code" }, h.deps);
  assert.equal(result.body.number, "000123"); assert.ok(!h.calls.includes("add"));
  assert.equal(h.customers[0].balance, 88); assert.equal(h.user.points, undefined);
});
test("lost creation response recovers by fixed number after process-state reload without another create", async () => {
  const h = setup(), add = h.deps.client.addCustomer;
  h.deps.client.addCustomer = async body => { await add(body); throw new Error("timeout"); };
  assert.equal((await provisionMember(h.state, h.user, { phoneCode: "wx-code" }, h.deps)).status, 503);
  assert.equal(getMemberCode(h.state, h.user).body.available, false);
  const restored = h.persisted();
  restored.config.pospalIntegration.memberProvisions[h.user.id].retryAt = "2000-01-01";
  const result = await provisionMember(restored, restored.users[0], {}, { ...h.deps, save: async () => {} });
  assert.equal(result.body.available, true);
  assert.equal(h.calls.filter(v => v === "add").length, 1);
});
test("failed intent persistence prevents external requests", async () => {
  const h = setup(); h.deps.save = async () => { throw new Error("disk unavailable"); };
  await assert.rejects(provisionMember(h.state, h.user, { phoneCode: "wx-code" }, h.deps));
  assert.deepEqual(h.calls, ["verify"]);
});
test("failed final save hides card and later reconciles the same customer", async () => {
  const h = setup(), save = h.deps.save;
  h.deps.save = async () => { if (h.user.pospalUid) throw new Error("save failed"); return save(); };
  assert.equal((await provisionMember(h.state, h.user, { phoneCode: "wx-code" }, h.deps)).status, 503);
  assert.equal(getMemberCode(h.state, h.user).body.available, false);
  h.state.config.pospalIntegration.memberProvisions[h.user.id].retryAt = "2000-01-01";
  h.deps.save = save;
  assert.equal((await provisionMember(h.state, h.user, {}, h.deps)).body.available, true);
  assert.equal(h.calls.filter(v => v === "add").length, 1);
});
test("unverified input, inactive membership and conflicting local phone never create a member", async () => {
  for (const mode of ["anonymous", "expired", "raw-phone", "duplicate-phone", "partial-identity"]) {
    const h = setup(); let input = { phoneCode: "wx-code" }, user = h.user;
    if (mode === "anonymous") user = null;
    if (mode === "expired") user.memberUntil = "2000-01-01";
    if (mode === "raw-phone") input = { phone: "13800000000" };
    if (mode === "duplicate-phone") h.state.users.push({ id: "other", phone: "13800000000" });
    if (mode === "partial-identity") user.pospalUid = "old";
    const result = await provisionMember(h.state, user, input, h.deps);
    assert.ok(result.status >= 400, mode); assert.ok(!h.calls.includes("add"));
  }
});
test("ambiguous, disabled, foreign or incomplete POS lookup results cannot be linked", async () => {
  for (const mode of ["duplicate", "disabled", "foreign", "incomplete", "linked-elsewhere"]) {
    const h = setup();
    const row = { uid: "existing", number: "001", tel: "13800000000", enable: 1 };
    h.customers.push(row);
    if (mode === "duplicate") h.customers.push({ ...row, uid: "duplicate", number: "002" });
    if (mode === "disabled") row.enable = 0;
    if (mode === "linked-elsewhere") h.state.users.push({ id: "other", pospalUid: row.uid });
    if (mode === "foreign") h.deps.client.queryCustomers = async () => ({ result: { list: [{ ...row, tel: "13900000000" }] } });
    if (mode === "incomplete") h.deps.client.queryCustomers = async () => ({ result: { list: [], hasMore: true } });
    assert.equal((await provisionMember(h.state, h.user, { phoneCode: "wx-code" }, h.deps)).status, 503, mode);
    assert.equal(h.user.pospalUid, undefined); assert.ok(!h.calls.includes("add"));
  }
});
test("WeChat phone uses official server response, validates appid and never accepts client phone data", async () => {
  const env = { WECHAT_APPID: "app", WECHAT_APPSECRET: "secret" };
  for (const mode of ["ok", "wrong-app", "bad-phone", "provider-error", "network-error"]) {
    let count = 0;
    const fetchImpl = async (url, options) => {
      count++;
      if (count === 1) {
        assert.equal(url, "https://api.weixin.qq.com/cgi-bin/stable_token");
        return { ok: true, json: async () => ({ access_token: "test-token" }) };
      }
      assert.deepEqual(JSON.parse(options.body), { code: "wx-code" });
      if (mode === "network-error") throw new Error("test-token secret");
      return { ok: true, json: async () => mode === "provider-error" ? { errcode: 40029 } : { phone_info: {
        purePhoneNumber: mode === "bad-phone" ? "bad" : "13800000000", countryCode: "86", watermark: { appid: mode === "wrong-app" ? "other" : "app" }
      } } };
    };
    if (mode === "ok") assert.equal(await exchangePhoneCode("wx-code", { env, fetchImpl }), "13800000000");
    else await assert.rejects(exchangePhoneCode("wx-code", { env, fetchImpl }), error => !/test-token|secret/.test(error.message));
  }
});
