process.env.TGG_STORE_MODE = 'memory';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createSeed } = require('../../src/data/seed');
const service = require('../../src/services/coin-signin-service');
const rules = require('../../src/services/coin-signin-config');
function native(t) {
  const previous = process.env.SIGNIN_AD_VERIFICATION_MODE; process.env.SIGNIN_AD_VERIFICATION_MODE = 'wechat_client';
  t.after(() => { if (previous === undefined) delete process.env.SIGNIN_AD_VERIFICATION_MODE; else process.env.SIGNIN_AD_VERIFICATION_MODE = previous; });
  const state = createSeed(), user = state.users[0];
  state.config.coinSignin = { ...structuredClone(rules.defaults), enabled: true, rewardAsset: 'points', minRounds: 2, maxRounds: 2,
    rewardedAdUnitId: 'adunit-rewarded01', interstitialAdUnitId: 'adunit-interstitial01' };
  state.coinSignin = { sessions: [], ledger: [] };
  const deps = { now: Date.parse('2026-11-26T03:00:00Z'), persist: async () => {} };
  const call = (action, input = {}, extra = {}) => service.execute(state, user, action, input, { ...deps, ...extra });
  return { state, user, deps, call };
}
async function finishRound(f, sessionId, key) {
  let result = await f.call('round', { sessionId, idempotencyKey: key }); assert.equal(result.ok, true, result.error);
  for (const step of result.attempt.steps) {
    const input = { sessionId, attemptId: result.attempt.id, stepId: step.id };
    const began = await f.call('begin', input); assert.equal(began.ok, true, began.error);
    f.deps.now += 2000;
    result = await f.call('step', { ...input, completionToken: began.completionToken, nativeCompletion: { closed: true, isEnded: step.type === 'rewarded' } });
    assert.equal(result.ok, true, result.error);
  }
  return result;
}
test('native signup binds step tokens, sequence, user, server time and completed-video result', async t => {
  const f = native(t), session = (await f.call('start')).session;
  const round = await f.call('round', { sessionId: session.id, idempotencyKey: 'native-bound-round' });
  const input = { sessionId: session.id, attemptId: round.attempt.id, stepId: round.attempt.steps[0].id };
  assert.equal((await f.call('step', { ...input, nativeCompletion: { closed: true, isEnded: true } })).status, 409);
  const began = await f.call('begin', input); assert.ok(began.completionToken);
  assert.equal((await service.execute(f.state, f.state.users[1], 'begin', input, f.deps)).status, 409);
  assert.equal((await f.call('begin', { ...input, stepId: round.attempt.steps[1].id })).status, 409);
  const completion = { ...input, completionToken: began.completionToken, nativeCompletion: { closed: true } };
  assert.equal((await f.call('step', completion)).status, 409, 'instant replay is rejected'); f.deps.now += 2000;
  assert.equal((await f.call('step', { ...completion, completionToken: 'forged' })).status, 409);
  assert.equal((await f.call('step', completion)).ok, true);
  const second = { ...input, stepId: round.attempt.steps[1].id }, token = (await f.call('begin', second)).completionToken;
  f.deps.now += 2000;
  assert.equal((await f.call('step', { ...second, completionToken: token, nativeCompletion: { closed: true, isEnded: false } })).status, 409);
  assert.equal((await f.call('claim', { sessionId: session.id })).status, 409);
  assert.equal(JSON.stringify(service.status(f.state, f.user)).includes(began.completionToken), false);
});
test('new sign-in rewards enter spendable points once without inviter commission; persistence failure rolls back all entries', async t => {
  const f = native(t), beforePoints = f.user.points, beforeUsers = f.state.users.map(u => u.points), initialLedger = f.state.pointLedger.length;
  const sessionId = (await f.call('start')).session.id;
  await finishRound(f, sessionId, 'native-reward-round1');
  assert.equal((await f.call('round', { sessionId, idempotencyKey: 'native-reward-round2' })).status, 409);
  f.deps.now += 20000; await finishRound(f, sessionId, 'native-reward-round2');
  await assert.rejects(f.call('claim', { sessionId }, { persist: async () => { throw Error('disk full'); } }), /disk full/);
  assert.equal(f.user.points, beforePoints); assert.equal(f.state.pointLedger.length, initialLedger); assert.equal(f.state.coinSignin.ledger.length, 0);
  const result = await f.call('claim', { sessionId }); assert.equal(result.ok, true);assert.equal(result.unit, '积分');
  await f.call('claim', { sessionId });
  assert.equal(f.user.points, beforePoints + 10);assert.equal(f.state.pointLedger.length, initialLedger + 1);
  assert.equal(f.state.coinSignin.ledger[0].rewardAsset, 'points');
  assert.equal(f.state.pointLedger[0].points, 10); assert.equal(f.state.pointLedger[0].changeType, 'signin_reward');
  assert.deepEqual(f.state.users.slice(1).map(u => u.points), beforeUsers.slice(1));
});
test('mini-program uses entry interstitial then user-triggered rewarded and interstitial, keeping 20-second server cooldown', async t => {
  const f = native(t), storage = { tgg_user: { id: f.user.id }, tgg_token: 'test-only' }, ads = [], calls = [];
  const root = path.resolve(__dirname, '../../../../wechat-miniprogram'); let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/coin-signin/index.js'), 'utf8'), {
    Page: value => { page = value; }, setInterval: () => 1, clearInterval() {},
    wx: { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; }, removeStorageSync: key => { delete storage[key]; }, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} },
    require: name => name.endsWith('/api') ? { request: async (url, options) => {
      calls.push(url); const action = url.split('/').at(-1);
      const result = action === 'status' ? service.status(f.state, f.user, f.deps.now) : await f.call(action, options.data);
      if (!result.ok) throw Object.assign(Error(result.error), { statusCode: result.status });return result;
    } } : { showSigninAd: step => { ads.push(step.type); f.deps.now += 2000; return { promise: Promise.resolve({ closed: true, isEnded: true }), cancel() {} }; } }
  });
  page.setData = values => Object.assign(page.data, values); page.owner = f.user.id; page.hidden = false;
  await page.load(); assert.deepEqual(ads, ['interstitial']);assert.equal(page.data.busy, false);assert.equal(page.data.sheet, '');
  await page.openSignin(); assert.deepEqual(ads, ['interstitial', 'rewarded', 'interstitial']);assert.equal(page.data.session.completedRounds, 1);assert.equal(page.data.countdown, 20);
  await page.openSignin();assert.equal(ads.length, 3);
  f.deps.now += 20000;page.offset = f.deps.now - Date.now();page.tick();
  for (let i = 0; i < 10 && page.data.busy; i++) await new Promise(setImmediate);
  assert.deepEqual(ads, ['interstitial', 'rewarded', 'interstitial', 'interstitial']);
  await page.openSignin();assert.equal(page.data.session.completedRounds, 2);
  await page.claim();assert.equal(page.data.sheet, 'success');assert.equal(f.state.pointLedger.filter(e => e.changeType === 'signin_reward').length, 1);
  assert.equal(calls.filter(url => url.endsWith('/begin')).length, 6);
});
test('a failed sign-in save does not roll back another operation ledger or points', async t => {
  const f = native(t);f.state.config.coinSignin.minRounds = 1;f.state.config.coinSignin.maxRounds = 1;
  const sessionId = (await f.call('start')).session.id;await finishRound(f, sessionId, 'parallel-save-round');
  const previous = f.user.points, other = { id: 'independent-operation', userId: f.user.id, points: 3 };
  await assert.rejects(f.call('claim', { sessionId }, { persist: async () => {
    f.user.points += 3;f.state.pointLedger.unshift(other);throw Error('disk full');
  } }), /disk full/);
  assert.equal(f.user.points, previous + 3);assert.ok(f.state.pointLedger.includes(other));
  assert.equal(f.state.pointLedger.some(entry => entry.idempotencyKey?.startsWith('signin-points:')), false);
});
test('native ad frequency failures retry the same unfinished step in round one or two without replaying the rewarded video', async t => {
  for (const failAt of [2, 3, 5]) {
    const f = native(t), storage = { tgg_user: { id: f.user.id }, tgg_token: 'token' }, calls = [], ads = [];
    let page, failed = false;
    const root = path.resolve(__dirname, '../../../../wechat-miniprogram');
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/coin-signin/index.js'), 'utf8'), {
      Page: value => { page = value; }, setInterval: () => 1, clearInterval() {},
      wx: { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; }, removeStorageSync: key => { delete storage[key]; }, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} },
      require: name => name.endsWith('/api') ? { request: async (url, options) => {
        calls.push(url);const action = url.split('/').at(-1);
        const result = action === 'status' ? service.status(f.state, f.user, f.deps.now) : await f.call(action, options.data);
        if (!result.ok) throw Object.assign(Error(result.error), { statusCode: result.status });return result;
      } } : { showSigninAd: step => {
        const index = ads.length;ads.push(step.type);f.deps.now += 2000;
        if (index === failAt && !failed) {
          failed = true;return { promise: Promise.reject(Object.assign(Error('微信限制插屏播放（2002）'), { retryAfterSeconds: 60 })), cancel() {} };
        }
        return { promise: Promise.resolve({ closed: true, isEnded: true }), cancel() {} };
      } }
    });
    page.setData = values => Object.assign(page.data, values);page.owner = f.user.id;page.hidden = false;
    const nextRound = async () => {
      f.deps.now += 20000;page.offset = f.deps.now - Date.now();page.tick();
      for (let i = 0; i < 10 && page.data.busy; i++) await new Promise(setImmediate);
    };
    const recover = async () => {
      assert.equal(page.data.adRetryCountdown, 60);
      const before = calls.length, attempt = page.currentAttempt.attempt.id;
      await page.getRound();await page.openSignin();assert.equal(calls.length, before, 'cooldown blocks repeated ad requests');
      page.adRetryAt = Date.now() - 1;page.tick();await page.getRound();
      assert.equal(page.currentAttempt.attempt.id, attempt, 'resume the same issued attempt');
    };
    await page.load();await page.openSignin();
    if (failAt === 2) await recover();
    assert.equal(page.data.session.completedRounds, 1);
    await nextRound();
    if (failAt === 3) await recover();else await page.openSignin();
    if (failAt === 5) await recover();
    assert.equal(page.data.session.completedRounds, 2, 'round two can complete after the failed step is retried');
    assert.equal(calls.filter(url => url.endsWith('/round')).length, 2);
    assert.equal(ads.filter(type => type === 'rewarded').length, 2, 'successful videos never replay on interstitial errors');
    await page.claim();await page.claim();assert.equal(f.state.pointLedger.filter(entry => entry.changeType === 'signin_reward').length, 1);
  }
});
test('ad slots stay in the requested positions and category banner is within scrollable products', () => {
  const root = path.resolve(__dirname, '../../../../wechat-miniprogram/pages');
  const read = page => fs.readFileSync(path.join(root, page, 'index.wxml'), 'utf8');
  const home = read('home'); assert.ok(home.indexOf('<tgg-ad-slot') < home.indexOf('class="greet"'));assert.ok(home.indexOf('class="greet"') < home.indexOf('aria-label="商城公告"'));
  const shop = read('shop');assert.doesNotMatch(shop, /发现新鲜好物/);assert.ok(shop.indexOf('<tgg-ad-slot/>', shop.indexOf('class="product-scroll"')) < shop.indexOf('class="product-grid"'));
  for (const page of ['customer-service', 'membership', 'coin-signin']) assert.match(read(page), /<tgg-ad-slot kind="feed"\/>/);
  assert.ok(read('invite').indexOf('<tgg-ad-slot') < read('invite').indexOf('邀请有礼'));assert.doesNotMatch(read('tasks'), /攒积分，兑好物/);
});
