process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const growth = require("../../src/services/growth-service");
const catalog = require("../../src/services/catalog-service");
const admin = require("../../src/services/admin-service");

const actor = { role: { id: "super_admin", permissions: ["*"] } };

test("daily signin awards points once per Shanghai day", () => {
  const state = createSeed();
  const user = state.users[0];
  const before = user.points;
  const first = growth.claimDailySignin(state, user);
  const second = growth.claimDailySignin(state, user);
  assert.equal(first.signedToday, true);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(user.points, before + state.config.dailySigninRewardPoints);
  const entries = state.pointLedger.filter(item => item.changeType === "signin");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].idempotencyKey, `signin:${user.id}:${first.date}`);
});

test("home carousel accepts exactly three or five valid images and exposes them", () => {
  const state = createSeed();
  const three = ["/assets/a.png", "/uploads/b.png", "https://cdn.example/c.jpg"];
  const result = admin.updateConfig(state, { homeCarouselImages: three, reason: "carousel" }, actor);
  assert.deepEqual(result.homeCarouselImages, three);
  assert.deepEqual(catalog.getHome(state, null).carouselImages, three);
  const invalid = admin.updateConfig(state, { homeCarouselImages: ["/assets/a.png", "/assets/b.png"], reason: "invalid" }, actor);
  assert.equal(invalid.ok, false);
  assert.deepEqual(state.config.homeCarouselImages, three);
});
