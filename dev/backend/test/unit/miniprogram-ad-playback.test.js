const test = require("node:test");
const assert = require("node:assert/strict");
const { playAd } = require("../../../../wechat-miniprogram/utils/ad-playback");
function fake(show) {
  const callbacks = {};
  let destroyed = 0;
  const ad = { onClose(fn) { callbacks.close = fn; }, onError(fn) { callbacks.error = fn; }, offClose() { delete callbacks.close; }, offError() { delete callbacks.error; }, destroy() { destroyed++; }, load: async () => {}, show: () => show(callbacks) };
  return { api: { createRewardedVideoAd: () => ad, createInterstitialAd: () => ad }, callbacks, destroyed: () => destroyed };
}
test("close event during show is captured and listeners cleaned", async () => {
  const sdk = fake(callbacks => { callbacks.close({ isEnded: true }); return Promise.resolve(); });
  await playAd(sdk.api, "reward_video", "test-unit").promise;
  assert.equal(sdk.destroyed(), 1);
  assert.deepEqual(sdk.callbacks, {});
});
test("incomplete playback does not produce completion", async () => {
  const sdk = fake(callbacks => { callbacks.close({ isEnded: false }); return Promise.resolve(); });
  await assert.rejects(playAd(sdk.api, "reward_video", "test-unit").promise, /完整观看/);
  assert.equal(sdk.destroyed(), 1);
});
test("page unload cancels playback and releases listeners", async () => {
  const sdk = fake(() => Promise.resolve());
  const playback = playAd(sdk.api, "reward_video", "test-unit");
  playback.cancel();
  await assert.rejects(playback.promise, /取消/);
  assert.deepEqual(sdk.callbacks, {});
  assert.equal(sdk.destroyed(), 1);
});
