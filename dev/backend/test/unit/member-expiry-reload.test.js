process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { normalizeState } = require("../../src/data/state-normalizer");
const { isMember } = require("../../src/domain/rules");

test("reloading stored users never grants free membership to an expired seeded account", () => {
  for (const expiry of ["2020-01-01T00:00:00.000Z", null, "invalid-date"]) {
    const state = createSeed();
    const user = state.users.find(item => item.id === "u_1001");
    user.memberUntil = expiry;
    const reloaded = normalizeState(JSON.parse(JSON.stringify(state))).users.find(item => item.id === user.id);
    assert.equal(reloaded.memberUntil, expiry);
    assert.equal(isMember(reloaded), false);
  }
});
