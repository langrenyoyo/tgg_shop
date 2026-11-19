// Explicit test-process preload. No production bypass or real provider calls.
if (process.env.TGG_TEST_BYPASS_ENABLED !== "1" || process.env.NODE_ENV === "production") throw new Error("POSPAL fixture requires an isolated test process");
const seed = require("../../src/data/seed");
const customers = new Map();
const initialExpiries = new Map();
const originalSeed = seed.createSeed;
const formatExpiry = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
seed.createSeed = () => {
  const state = originalSeed();
  state.config.userPhoneVerifications = {};
  state.config.pospalIntegration = { customerMappings: [] };
  state.users.forEach((user, index) => {
    if (!initialExpiries.has(user.id)) initialExpiries.set(user.id, user.memberUntil);
    user.memberUntil = initialExpiries.get(user.id);
    const phone = `1390000${String(index + 1).padStart(4, "0")}`;
    const uid = `fixture-uid-${index}`, number = `fixture-card-${index}`;
    Object.assign(user, { phone, pospalUid: uid, pospalNumber: number });
    state.config.userPhoneVerifications[user.id] = { source: "wechat", phone, verifiedAt: new Date().toISOString() };
    state.config.pospalIntegration.customerMappings.push({ tggUserId: user.id, phone, pospalUid: uid, number, account: "fixture-store" });
    if (!customers.has(number)) customers.set(number, { uid, number, tel: phone, enable: 1, isLoss: 0, active: 0, expiryDate: user.memberUntil ? formatExpiry(user.memberUntil) : "2000-01-01 00:00:00" });
  });
  return state;
};
// SQLite's migrations contain their own sample rows. Initialize the simulated
// store from those rows too, instead of assuming the JS seed supplied them.
const sqlite = require("../../src/data/sqlite-store");
const originalLoad = sqlite.loadSQLiteState;
sqlite.loadSQLiteState = (...args) => {
  const state = originalLoad(...args), fixture = seed.createSeed();
  state.config.userPhoneVerifications = fixture.config.userPhoneVerifications;
  state.config.pospalIntegration = fixture.config.pospalIntegration;
  for (const user of state.users) {
    const mapping = state.config.pospalIntegration.customerMappings.find(row => row.tggUserId === user.id);
    if (!mapping) continue;
    Object.assign(user, { phone: mapping.phone, pospalUid: mapping.pospalUid, pospalNumber: mapping.number });
    customers.get(mapping.number).expiryDate = user.memberUntil ? formatExpiry(user.memberUntil) : "2000-01-01 00:00:00";
  }
  return state;
};
require("../../src/integrations/pospal/pospal-client").createPospalClient = () => ({
  config: { baseUrl: "https://pospal.example.test", appId: "fixture", appKey: "fixture", account: "fixture-store" },
  async queryCustomers(body) {
    return { result: { list: structuredClone([...customers.values()].filter(row => (!body.number || row.number === body.number) && (!body.tel || row.tel === body.tel))), hasMore: false } };
  },
  async updateCustomer(body) {
    const row = customers.get(body.number);
    if (!row) throw new Error("Unknown fixture customer");
    if (body.updateMask.includes("expiryDate")) row.expiryDate = body.expiryDate;
    return { status: "success" };
  }
});
