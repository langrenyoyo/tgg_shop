process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { handleGrowthRoutes } = require("../../src/routes/growth-routes");
const catalog = require("../../src/services/catalog-service");
const account = require("../../src/services/account-service");
const { activeConfig } = require("../../src/config/active-config");
const admin = require("../../src/services/admin-service");

test("retired advertising endpoints cannot spend old tickets or issue rewards", async () => {
  const state = createSeed();
  const user = state.users[0];
  state.signinSessions.push({ sessionId: "old-session", userId: user.id, signedToday: true, lotteryTicket: 1, lotteryUsed: false });
  const before = structuredClone(state);
  for (const method of ["GET", "POST"]) {
    for (const endpoint of ["status", "start", "ad_complete", "lottery_spin"]) {
      for (let retry = 0; retry < 2; retry++) {
        let response;
        await handleGrowthRoutes({
          req: { method }, url: new URL("http://localhost/api/signin/" + endpoint), state, user,
          readBody: () => { throw new Error("Retired endpoint must not read a reward claim"); },
          send: (_, status, body) => { response = { status, body }; }
        });
        assert.equal(response.status, 410);
        assert.equal(response.body.code, "AD_FEATURE_REMOVED");
        assert.deepEqual(state, before);
      }
    }
  }
});

test("old homepage promotions and ledger records cannot link to removed sign-in pages", () => {
  const state = createSeed();
  const user = state.users[0];
  state.config.homePromotionEntries.push({ title: "Old promotion", page: "signin" });
  const activePromotions = catalog.getHome(state, user).promotionEntries;
  assert.ok(activePromotions.length > 0);
  assert.equal(activePromotions.some(item => item.page === "signin"), false);
  state.pointLedger.push({ id: "old-reward", userId: user.id, points: 10, changeType: "lottery", direction: "in", bizNo: "old-session", createdAt: new Date().toISOString() });
  const ledger = account.getPointLedger(state, user.id, { type: "lottery", page: 1, count: 20 });
  assert.equal(ledger.rows[0].points, 10);
  assert.equal(ledger.rows[0].source, null);
  assert.equal(state.config.homePromotionEntries.at(-1).page, "signin");
});

test("historical ad configuration stays stored but cannot be exposed or changed", () => {
  const state = createSeed();
  Object.assign(state.config, { splashAdEnabled: true, signinAdGroupMin: 3, lotteryPrizes: [{ value: 10 }] });
  const before = structuredClone(state);
  const config = activeConfig(state.config);
  assert.equal(config.splashAdEnabled, undefined);
  assert.equal(config.signinAdGroupMin, undefined);
  assert.equal(config.lotteryPrizes, undefined);
  assert.equal(config.membershipMonthlyPrice, state.config.membershipMonthlyPrice);
  const result = admin.updateConfig(state, { splashAdEnabled: true, membershipMonthlyPrice: 1 });
  assert.equal(result.status, 410);
  assert.deepEqual(state, before);
});

test("public config excludes POSPAL integration state and unknown internal fields", () => {
  const config = activeConfig({
    membershipMonthlyPrice: 19.9,
    pospalIntegration: {
      externalOrders: [{ raw: { orderNo: "POS-1", phone: "13800138000" } }],
      externalSales: [{ raw: { customerName: "private customer" } }]
    },
    rolePermissionOverrides: { super_admin: ["*"] },
    futureSecret: "must-not-be-public"
  });

  assert.equal(config.membershipMonthlyPrice, 19.9);
  assert.equal(config.pospalIntegration, undefined);
  assert.equal(config.rolePermissionOverrides, undefined);
  assert.equal(config.futureSecret, undefined);
  assert.equal(JSON.stringify(config).includes("POS-1"), false);
  assert.equal(JSON.stringify(config).includes("13800138000"), false);
});
