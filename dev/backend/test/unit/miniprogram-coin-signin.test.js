process.env.TGG_STORE_MODE = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSeed } = require('../../src/data/seed');
const service = require('../../src/services/coin-signin-service');
const { defaults } = require('../../src/services/coin-signin-config');
const source = file => fs.readFileSync(path.resolve(__dirname, '../../../../wechat-miniprogram', file), 'utf8');
function adHarness(mode) {
  const module = { exports: {} }, handlers = {}; let shown = 0, destroyed = 0;
  const ad = { onClose(fn) { handlers.close = fn; }, offClose() { delete handlers.close; }, onError(fn) { handlers.error = fn; }, offError() { delete handlers.error; },
    load: async () => { if (mode === 'load-error') throw Error('no fill'); }, show: async () => { shown++; if (mode === 'show-error') throw Error('unavailable'); }, destroy: () => destroyed++ };
  vm.runInNewContext(source('utils/signin-ad.js'), { module, wx: { createRewardedVideoAd: () => ad, createInterstitialAd: () => ad }, setTimeout, clearTimeout });
  return { show: module.exports.showSigninAd, handlers, stats: () => ({ shown, destroyed }) };
}
for (const scenario of [{ type: 'rewarded', result: { isEnded: true }, ok: true }, { type: 'rewarded', result: { isEnded: false } },
  { type: 'rewarded', result: undefined }, { type: 'interstitial', result: undefined, ok: true }]) {
  test(`native ad close ${scenario.type} ${JSON.stringify(scenario.result)} requires completion`, async () => {
    const h = adHarness(), task = h.show({ type: scenario.type, adUnitId: 'adunit-rewarded01' });
    const finished = task.promise.then(() => true, () => false);
    await new Promise(setImmediate); h.handlers.close(scenario.result);
    assert.equal(await finished, Boolean(scenario.ok)); assert.deepEqual(h.stats(), { shown: 1, destroyed: 1 }); assert.equal(h.handlers.close, undefined);
  });
}
for (const mode of ['load-error', 'show-error']) test(`native ad ${mode} rejects and cleans up`, async () => {
  const h = adHarness(mode), task = h.show({ type: 'rewarded', adUnitId: 'adunit-rewarded01' });
  await assert.rejects(task.promise); assert.equal(h.stats().destroyed, 1);
});
test('native cancellation detaches listeners and never resolves completion', async () => {
  const h = adHarness(), task = h.show({ type: 'rewarded', adUnitId: 'adunit-rewarded01' });
  const rejected = assert.rejects(task.promise); task.cancel(); await rejected;
  assert.equal(h.stats().destroyed, 1); assert.equal(h.handlers.close, undefined);
});
function pageHarness(options = {}) {
  const state = createSeed(), user = state.users[0];
  state.coinSignin = { sessions: [], ledger: [] };
  state.config.coinSignin = { ...structuredClone(defaults), enabled: !options.disabled, minRounds: 2, maxRounds: 2, intervalSeconds: 0,
    rewardedAdUnitId: 'adunit-rewarded01', interstitialAdUnitId: 'adunit-interstitial01' };
  const deps = { persist: async () => {}, verifier: { configured: () => true, verify: async c => ({ receiptId: c.stepId }) } };
  const storage = { tgg_user: { id: user.id }, tgg_token: 'token' }, calls = []; let page, ads = 0, failResponse = options.failResponse;
  const request = async (url, opts) => {
    calls.push(url);
    if (options.request) await options.request(url, opts);
    const result = url.endsWith('/status') ? service.status(state, user, Date.now(), deps.verifier) : await service.execute(state, user, url.split('/').at(-1), opts.data, deps);
    if (failResponse && url.endsWith('/step')) { failResponse = false; throw Error('network response lost'); }
    if (!result.ok) { const error = Error(result.error); error.statusCode = result.status; throw error; }
    return structuredClone(result);
  };
  vm.runInNewContext(source('pages/coin-signin/index.js'), { Page: p => { page = p; },
    require: name => name.endsWith('/api') ? { request } : { showSigninAd: step => { ads++; return options.ad ? options.ad(step) : { promise: Promise.resolve(), cancel() {} }; } },
    setInterval: () => 1, clearInterval() {},
    wx: { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; }, removeStorageSync: key => { delete storage[key]; }, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} } });
  page.setData = value => Object.assign(page.data, value); page.owner = user.id; page.hidden = false;
  return { page, state, user, storage, calls, ads: () => ads };
}
test('mini-program completes configured groups and explicit claim into independent coins', async () => {
  const h = pageHarness(), before = structuredClone(h.user);
  await h.page.load(); await h.page.openSignin();
  await h.page.getRound(); assert.equal(h.page.data.session.completedRounds, 1);
  assert.equal(h.page.data.balanceCoins, 0);
  await h.page.getRound(); await h.page.claim(); await h.page.claim();
  assert.equal(h.ads(), 6); assert.equal(h.page.data.sheet, 'success'); assert.equal(h.page.data.balanceCoins, 10);
  assert.equal(h.state.coinSignin.ledger.length, 1); assert.deepEqual(h.user, before);
});
test('disabled activity never starts ads or creates sessions', async () => {
  const h = pageHarness({ disabled: true }); await h.page.load(); await h.page.openSignin(); await h.page.getRound();
  assert.equal(h.ads(), 0); assert.equal(h.state.coinSignin.sessions.length, 0); assert.ok(h.page.data.unavailableReason);
});
test('lost step response can be verified again without replaying the completed ad', async () => {
  const h = pageHarness({ failResponse: true }); await h.page.load(); await h.page.openSignin(); await h.page.getRound();
  assert.equal(h.ads(), 1); assert.equal(h.page.data.pendingStep, true);
  await h.page.retryVerification();
  assert.equal(h.ads(), 3); assert.equal(h.page.data.session.completedRounds, 1); assert.equal(h.page.data.pendingStep, false);
});
test('incomplete native ad never submits server verification or earns progress', async () => {
  const h = pageHarness({ ad: () => ({ promise: Promise.reject(Error('early close')), cancel() {} }) });
  await h.page.load(); await h.page.openSignin(); await h.page.getRound();
  assert.equal(h.calls.filter(url => url.endsWith('/step')).length, 0); assert.equal(h.page.data.session.completedRounds, 0);
});
test('account change while an ad is open blocks stale verification and storage writes', async () => {
  let resolve; const h = pageHarness({ ad: () => ({ promise: new Promise(done => { resolve = done; }), cancel() {} }) });
  await h.page.load(); await h.page.openSignin(); const pending = h.page.getRound();
  await new Promise(setImmediate); h.storage.tgg_user = { id: 'different-user' }; resolve(); await pending;
  assert.equal(h.calls.filter(url => url.endsWith('/step')).length, 0); assert.equal(h.state.coinSignin.ledger.length, 0);
  assert.equal(Object.keys(h.storage).filter(key => key.startsWith('tgg_coin_signin')).length, 0);
});
test('leaving clears unfinished verification; reentry keeps completed rounds and restarts partial group', async () => {
  const h = pageHarness(); await h.page.load(); await h.page.openSignin(); await h.page.getRound();
  h.storage[h.page.storageKey()] = { sessionId: h.page.data.session.id, attemptId: 'partial', stepId: 'step' };
  h.page.onHide(); assert.equal(h.storage[h.page.storageKey()], undefined);
  h.page.hidden = false; await h.page.load(); await h.page.openSignin(); await h.page.getRound();
  assert.equal(h.page.data.session.completedRounds, 2); assert.equal(h.ads(), 6);
});
