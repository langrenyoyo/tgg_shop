process.env.TGG_STORE_MODE = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const growth = require("../../src/services/growth-service");
const catalog = require("../../src/services/catalog-service");
const admin = require("../../src/services/admin-service");

const actor = { role: { id: "super_admin", permissions: ["*"] } };

test("retired one-click signin cannot award points or coins", () => {
  const state = createSeed();
  const user = state.users[0];
  const before = JSON.stringify(state);
  const first = growth.claimDailySignin(state, user);
  const second = growth.claimDailySignin(state, user);
  assert.equal(first.status, 410);
  assert.equal(second.status, 410);
  assert.equal(JSON.stringify(state), before);
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
