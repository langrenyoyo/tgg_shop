process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { normalizeState } = require("../../src/data/state-normalizer");
const payments = require("../../src/services/payment-service");
const admin = require("../../src/services/admin-service");
const { grantMembership, revokeMembership } = require("../../src/domain/product-membership");
const { enqueueMembershipSync, expiryDate } = require("../../src/domain/pospal-membership");
const { recordPhone } = require("../../src/services/phone-binding-service");
const { createMembershipWorker, membershipSyncStatus } = require("../../src/services/pospal-membership-service");
const { handlePospalRoutes } = require("../../src/routes/pospal-routes");
const { issueToken } = require("../../src/domain/auth");
const DAY = 86400000;

function setup() {
  const h = { state: createSeed(), customers: [], calls: [], clock: Date.now() };
  h.user = () => h.state.users.find(user => user.id === "u_1002");
  Object.assign(h.user(), { nickname: "测试会员", memberUntil: null, points: 1000 });
  h.state.config.membershipMonthlyPoints = 10;
  recordPhone(h.state, h.user(), "13912345678");
  h.job = () => h.state.config.pospalIntegration.membershipSyncJobs[h.user().id];
  h.save = async () => { h.calls.push("save"); h.persisted = structuredClone(h.state); };
  h.client = {
    config: { baseUrl: "https://example.test", appId: "app", appKey: "secret", account: "store" },
    async queryCustomers(body) {
      h.calls.push({ query: body });
      return { result: { list: structuredClone(h.customers.filter(row => (!body.number || row.number === body.number) && (!body.tel || row.tel === body.tel))), hasMore: false } };
    },
    async addCustomer(body) {
      assert.equal(h.persisted.config.pospalIntegration.memberProvisions[h.user().id].status, "creating");
      h.calls.push({ add: body });
      h.customers.push({ ...body, uid: "900000000000000001", customerExt: {} });
      return { status: "success" };
    },
    async updateCustomer(body) {
      assert.equal(h.persisted.config.pospalIntegration.membershipSyncJobs[h.user().id].status, "sending");
      h.calls.push({ update: body });
      const row = h.customers.find(item => item.number === body.number);
      for (const key of body.updateMask) {
        if (key === "customerExt.nickName") row.customerExt = { ...row.customerExt, nickName: body.customerExt.nickName };
        else row[key] = body[key];
      }
      return { status: "success" };
    }
  };
  h.worker = () => createMembershipWorker({ state: () => h.state, save: () => h.save(), client: h.client, now: () => h.clock });
  h.open = key => {
    const result = payments.createMemberPayment(h.state, h.user(), { paymentMode: "pure_points", months: 1, idempotencyKey: key });
    assert.equal(result.ok, true, result.error);
    return result;
  };
  h.retry = () => { h.clock += 3600001; const p = h.state.config.pospalIntegration.memberProvisions?.[h.user().id]; if (p) p.retryAt = "2000-01-01"; };
  return h;
}

test("points activation creates a member automatically; renewal updates the same card to the local absolute expiry", async () => {
  const h = setup(), worker = h.worker();
  h.open("open");
  const firstUntil = h.user().memberUntil;
  assert.equal(h.job().status, "pending");
  await worker.run();
  assert.equal(h.job().status, "synced");
  const card = h.user().pospalNumber;
  assert.equal(h.customers[0].tel, h.user().phone);
  assert.equal(h.customers[0].name, h.user().nickname);
  assert.equal(h.customers[0].expiryDate, expiryDate(firstUntil));
  h.open("renew");
  assert.equal(Date.parse(h.user().memberUntil) - Date.parse(firstUntil), 30 * DAY);
  const revision = h.job().revision;
  h.open("renew");
  assert.equal(h.job().revision, revision);
  await worker.run(); await worker.run();
  assert.equal(h.job().status, "synced");
  assert.equal(h.customers[0].expiryDate, expiryDate(h.user().memberUntil));
  assert.equal(h.user().pospalNumber, card);
  assert.equal(h.calls.filter(call => call.add).length, 1);
  assert.equal(h.calls.filter(call => call.update).length, 2);
  assert.equal(h.job().lastSyncedAt, h.persisted.config.pospalIntegration.membershipSyncJobs[h.user().id].lastSyncedAt);
});

test("existing unique phone member retains card, name, balance, points and discount while syncing expiry and nickname", async () => {
  const h = setup();
  h.customers.push({ uid: "existing", number: "000123", tel: h.user().phone, name: "门店真实姓名", enable: 1, money: 88, point: 99, discount: 85, expiryDate: "2040-01-01 00:00:00" });
  h.open("open"); await h.worker().run();
  assert.equal(h.job().status, "synced");
  assert.equal(h.user().pospalNumber, "000123");
  assert.equal(h.calls.filter(call => call.add).length, 0);
  const row = h.customers[0];
  assert.equal(row.expiryDate, expiryDate(h.user().memberUntil));
  assert.equal(row.name, "门店真实姓名"); assert.equal(row.customerExt.nickName, h.user().nickname);
  assert.equal(row.money, 88); assert.equal(row.point, 99); assert.equal(row.discount, 85);
  assert.deepEqual(h.calls.find(call => call.update).update.updateMask, ["expiryDate", "customerExt.nickName"]);
});

test("trusted gift payment queues once; bad or unpaid payment never queues membership sync", async () => {
  const h = setup();
  const order = { id: "gift-order", userId: h.user().id, status: "pending_payment", paymentMode: "cash", cashAmount: 20, pointAmount: 0, membershipGiftDays: 30, items: [], fulfillmentType: "pickup" };
  h.state.orders.push(order);
  const payment = payments.createGoodsPayment(h.state, order.id, { channel: "lfwin_wechat_mini" }).payment;
  assert.equal(h.state.config.pospalIntegration, undefined);
  const payload = { mch_orderid: payment.payNo, orderid: "provider-1", paystatus: "1", paymoney: "20.00" };
  assert.equal(payments.applyLfwinPaymentNotification(h.state, { ...payload, paymoney: "0.01" }, { verifyNotification: () => true }).ok, false);
  assert.equal(h.state.config.pospalIntegration, undefined);
  assert.equal(payments.applyLfwinPaymentNotification(h.state, payload, { verifyNotification: () => true }).ok, true);
  const until = h.user().memberUntil, revision = h.job().revision;
  assert.equal(payments.applyLfwinPaymentNotification(h.state, payload, { verifyNotification: () => true }).ok, true);
  assert.equal(h.job().revision, revision); assert.equal(h.user().memberUntil, until);
  await h.worker().run();
  assert.equal(h.customers[0].expiryDate, expiryDate(until));
});

test("lost creation acknowledgement recovers after reload without creating a second card", async () => {
  const h = setup(), add = h.client.addCustomer;
  h.client.addCustomer = async body => { await add(body); throw new Error("timeout"); };
  h.open("open"); await h.worker().run();
  assert.equal(h.job().status, "retry");
  h.state = normalizeState(structuredClone(h.persisted)); h.retry();
  await h.worker().run();
  assert.equal(h.job().status, "synced");
  assert.equal(h.calls.filter(call => call.add).length, 1);
});

test("lost update response retries the same expiry after reload, without extending it again", async () => {
  const h = setup(), update = h.client.updateCustomer;
  h.client.updateCustomer = async body => { await update(body); throw new Error("timeout appKey=secret"); };
  h.open("open"); const until = h.user().memberUntil;
  await h.worker().run();
  assert.equal(h.job().status, "retry");
  assert.equal(h.job().lastSyncedAt, null);
  assert.ok(!JSON.stringify(membershipSyncStatus(h.state)).includes("secret"));
  h.state = normalizeState(structuredClone(h.persisted)); h.retry();
  h.client.updateCustomer = update;
  await h.worker().run();
  assert.equal(h.job().status, "synced");
  assert.equal(h.user().memberUntil, until);
  assert.equal(h.customers[0].expiryDate, expiryDate(until));
  assert.equal(h.calls.filter(call => call.add).length, 1);
});

test("success acknowledgement alone never marks an unconfirmed expiry as synced", async () => {
  const h = setup(); h.open("open"); await h.worker().run();
  h.open("renew"); h.client.updateCustomer = async () => ({ status: "success" });
  await h.worker().run();
  assert.equal(h.job().status, "retry");
  assert.equal(h.job().lastError.code, "unconfirmed");
});

test("a renewal arriving during external update remains pending and ultimately sends the latest expiry", async () => {
  const h = setup(), update = h.client.updateCustomer;
  let renewed = false;
  h.client.updateCustomer = async body => {
    if (!renewed) { renewed = true; h.open("concurrent-renewal"); }
    return update(body);
  };
  h.open("open"); const worker = h.worker();
  await Promise.all([worker.run(), worker.run()]);
  assert.equal(h.job().status, "pending");
  await worker.run();
  assert.equal(h.job().status, "synced");
  assert.equal(h.customers[0].expiryDate, expiryDate(h.user().memberUntil));
  assert.equal(h.calls.filter(call => call.add).length, 1);
});

test("refund and admin removal send a finite expired date instead of clearing the provider expiry", async () => {
  const h = setup();
  const order = { id: "gift", userId: h.user().id, paymentMode: "cash", cashAmount: 1, status: "paid", membershipGiftDays: 30 };
  h.state.orders.push(order); grantMembership(h.state, order);
  await h.worker().run();
  revokeMembership(h.state, order);
  await h.worker().run();
  assert.equal(h.customers[0].expiryDate, expiryDate(h.user().memberUntil));
  h.open("renew"); await h.worker().run();
  const result = admin.updateUser(h.state, h.user().id, { clearMember: true, reason: "纠正", idempotencyKey: "clear" }, { role: { permissions: ["*"] } });
  assert.equal(result.ok, true); assert.equal(h.user().memberUntil, null);
  await h.worker().run();
  assert.equal(h.job().status, "synced");
  assert.ok(h.customers[0].expiryDate);
  assert.ok(h.customers[0].expiryDate <= expiryDate(Date.now()));
  assert.ok(h.calls.filter(call => call.update).every(call => !call.update.clearFields));
});

test("missing verified phone is visible and authorization resumes the pending job", async () => {
  const h = setup(); delete h.state.config.userPhoneVerifications[h.user().id];
  h.open("open"); await h.worker().run();
  assert.equal(h.job().status, "waiting_phone");
  assert.equal(h.calls.filter(call => call.add || call.update || call.query).length, 0);
  recordPhone(h.state, h.user(), h.user().phone);
  assert.equal(h.job().status, "pending");
  await h.worker().run(); assert.equal(h.job().status, "synced");
});

test("disabled, duplicate, incomplete and foreign identities never receive an expiry update", async () => {
  for (const mode of ["disabled", "duplicate", "foreign", "incomplete", "duplicate-local", "lost"]) {
    const h = setup(); h.open("open"); await h.worker().run();
    h.calls.length = 0; h.open("renew");
    if (mode === "disabled") h.customers[0].enable = 0;
    if (mode === "lost") h.customers[0].active = -10;
    if (mode === "duplicate") h.customers.push({ ...h.customers[0], uid: "other" });
    if (mode === "foreign") h.customers[0].tel = "13812345678";
    if (mode === "incomplete") h.client.queryCustomers = async () => ({ result: { list: [], hasMore: true } });
    if (mode === "duplicate-local") h.state.users.push({ id: "other", phone: h.user().phone });
    await h.worker().run();
    assert.equal(h.job().status, "retry", mode);
    assert.equal(h.calls.filter(call => call.update || call.add).length, 0, mode);
  }
});

test("missing config and changed account preserve local membership and block external writes", async () => {
  for (const mode of ["missing", "changed"]) {
    const h = setup(); h.open("open");
    if (mode === "missing") h.client.config.appKey = "";
    else { await h.worker().run(); h.open("renew"); h.client.config.account = "other"; }
    h.calls.length = 0; const until = h.user().memberUntil;
    await h.worker().run();
    assert.equal(h.job().status, "retry");
    assert.equal(h.user().memberUntil, until);
    assert.equal(h.calls.filter(call => call.query || call.add || call.update).length, 0);
  }
});

test("a local identity change during provider lookup blocks the external expiry write", async () => {
  const h = setup(); h.open("open"); await h.worker().run();
  h.open("renew"); h.calls.length = 0;
  const query = h.client.queryCustomers;
  h.client.queryCustomers = async body => { const result = await query(body); h.user().phone = "13812345678"; return result; };
  await h.worker().run();
  assert.equal(h.job().status, "retry");
  assert.equal(h.job().lastError.code, "identity_conflict");
  assert.equal(h.calls.filter(call => call.update).length, 0);
});

test("persistence failure halts worker before external requests; reload can resume durable sending intent", async () => {
  const h = setup(); h.open("open");
  h.save = async () => { throw new Error("disk unavailable"); };
  const worker = h.worker();
  await assert.rejects(worker.run(), /disk unavailable/);
  await worker.run();
  assert.equal(h.calls.length, 0);
  h.save = async () => { h.persisted = structuredClone(h.state); };
  await h.worker().run();
  assert.equal(h.job().status, "synced");
});

test("failed completion save recovers from durable sending state with the same member and expiry", async () => {
  const h = setup(), save = h.save;
  h.save = async () => { if (h.job().status === "synced") throw new Error("disk unavailable"); return save(); };
  h.open("open");
  await assert.rejects(h.worker().run(), /disk unavailable/);
  assert.equal(h.persisted.config.pospalIntegration.membershipSyncJobs[h.user().id].status, "sending");
  h.state = normalizeState(structuredClone(h.persisted)); h.save = save;
  await h.worker().run();
  assert.equal(h.job().status, "synced");
  assert.equal(h.customers.length, 1);
  assert.equal(h.customers[0].expiryDate, expiryDate(h.user().memberUntil));
});

test("expiry conversion is Beijing time across a UTC date boundary and retains seconds", () => {
  assert.equal(expiryDate("2026-12-31T18:02:03.999Z"), "2027-01-01 02:02:03");
});

test("provider quota failure during first provisioning is actionable and backs off for one hour", async () => {
  const h = setup(); h.open("open");
  h.client.queryCustomers = async () => { throw Object.assign(new Error("secret"), { errorCode: 4021 }); };
  await h.worker().run();
  assert.equal(h.job().status, "retry");
  assert.match(h.job().lastError.message, /Token/);
  assert.equal(Date.parse(h.job().nextAttemptAt) - h.clock, 3600000);
  assert.ok(!JSON.stringify(h.job()).includes("secret"));
});

test("failed provisioning intent save prevents member creation and pauses the worker", async () => {
  const h = setup(), save = h.save; h.open("open");
  h.save = async () => {
    if (h.state.config.pospalIntegration.memberProvisions?.[h.user().id]) throw new Error("intent save failed");
    return save();
  };
  await assert.rejects(h.worker().run(), /intent save failed/);
  assert.equal(h.calls.filter(call => call.query || call.add || call.update).length, 0);
});

test("admin retry and status endpoints enforce integration permissions and expose pending versus confirmed state", async () => {
  const h = setup();
  const request = async (role, method, path) => {
    let headers = {};
    if (role) {
      const token = issueToken({ type: "admin", roleId: role });
      const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
      h.state.authSessions.push({ subjectType: "admin", subjectId: role, tokenId: payload.tokenId, expiresAt: new Date(payload.exp * 1000).toISOString() });
      headers = { authorization: `Bearer ${token}` };
    }
    let response;
    await handlePospalRoutes({ req: { method, headers }, url: new URL(path, "http://localhost"), state: h.state, send: (_, status, body) => { response = { status, body }; } });
    return response;
  };
  const path = `/api/admin/integrations/pospal/members/${h.user().id}/sync`;
  assert.equal((await request(null, "POST", path)).status, 401);
  assert.equal((await request("customer_service", "POST", path)).status, 403);
  assert.equal(h.state.config.pospalIntegration, undefined);
  h.open("open");
  const until = h.user().memberUntil;
  const queued = await request("super_admin", "POST", path);
  assert.equal(queued.status, 202); assert.equal(queued.body.job.status, "pending");
  assert.equal(h.user().memberUntil, until);
  assert.equal(h.calls.filter(call => call.add || call.update).length, 0);
  assert.equal((await request("customer_service", "GET", "/api/admin/integrations/pospal/status")).status, 403);
  await h.worker().run();
  const status = await request("super_admin", "GET", "/api/admin/integrations/pospal/status");
  assert.equal(status.status, 200);
  assert.equal(status.body.membershipSync.counts.synced, 1);
  assert.equal(status.body.membershipSync.jobs[0].expiryDate, expiryDate(until));
  assert.ok(!JSON.stringify(status.body).includes("secret"));
});
