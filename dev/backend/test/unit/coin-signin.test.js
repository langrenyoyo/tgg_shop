process.env.TGG_STORE_MODE = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSeed } = require('../../src/data/seed');
const service = require('../../src/services/coin-signin-service');
const rules = require('../../src/services/coin-signin-config');
const admin = require('../../src/services/admin-service');
const verifier = require('../../src/services/signin-ad-verifier');
const NOW = Date.parse('2026-11-03T04:00:00Z');
function fixture(overrides = {}) {
  const state = createSeed(), user = state.users[0];
  state.coinSignin = { sessions: [], ledger: [] };
  state.config.coinSignin = { ...structuredClone(rules.defaults), enabled: true, minRounds: 2, maxRounds: 2,
    rewardedAdUnitId: 'adunit-rewarded01', interstitialAdUnitId: 'adunit-interstitial01', ...overrides };
  const deps = { now: NOW, persist: async () => {}, verifier: { configured: () => true, verify: async c => ({ receiptId: c.stepId }) } };
  const call = (action, input = {}, extra = {}) => service.execute(state, user, action, input, { ...deps, ...extra });
  return { state, user, deps, call };
}
async function start(f) { const r = await f.call('start'); assert.equal(r.ok, true); return r.session.id; }
async function round(f, sessionId, key = crypto.randomUUID()) { const r = await f.call('round', { sessionId, idempotencyKey: key }); assert.equal(r.ok, true, r.error); return r; }
async function complete(f, r) {
  for (const step of r.attempt.steps.slice(r.attempt.nextStep)) {
    r = await f.call('step', { sessionId: r.session.id, attemptId: r.attempt.id, stepId: step.id });
    assert.equal(r.ok, true, r.error);
  }
  return r;
}

test('coin signin fails closed without activity, ad IDs or independent verifier', async () => {
  for (const kind of ['disabled', 'ids', 'verifier']) {
    const f = fixture();
    if (kind === 'disabled') f.state.config.coinSignin.enabled = false;
    if (kind === 'ids') f.state.config.coinSignin.rewardedAdUnitId = '';
    if (kind === 'verifier') f.deps.verifier.configured = () => false;
    const before = structuredClone(f.state.coinSignin);
    assert.equal((await f.call('start')).status, 503);
    assert.deepEqual(f.state.coinSignin, before);
    assert.equal(service.status(f.state, f.user, NOW, f.deps.verifier).balanceCoins, 0);
  }
});
test('coin signin configuration validates atomically and permits disabled drafts', () => {
  const f = fixture(), actor = { role: { id: 'super_admin', permissions: ['*'] } };
  assert.equal(rules.validate(structuredClone(rules.defaults)), null);
  for (const change of [{ minRounds: 5, maxRounds: 2 }, { rewardCoins: 1.5 }, { minRounds: 0 }, { sequence: ['interstitial'] },
    { sequence: ['rewarded', 'bogus'] }, { rewardedAdUnitId: 'fake' }, { enabled: 'true' }, { unknown: true }]) {
    const before = JSON.stringify(f.state);
    assert.equal(admin.updateConfig(f.state, { coinSignin: { ...f.state.config.coinSignin, ...change } }, actor).ok, false);
    assert.equal(JSON.stringify(f.state), before);
  }
  admin.updateConfig(f.state, { coinSignin: structuredClone(rules.defaults), reason: 'draft' }, actor);
  assert.deepEqual(f.state.config.coinSignin, rules.defaults);
});
test('random bounds are inclusive and starting again preserves session and rule snapshot', async t => {
  for (const value of [2, 4]) {
    t.mock.method(crypto, 'randomInt', (min, exclusiveMax) => { assert.equal(min, 2); assert.equal(exclusiveMax, 5); return value; });
    const f = fixture({ minRounds: 2, maxRounds: 4 });
    const sessionId = await start(f);
    f.state.config.coinSignin = { ...f.state.config.coinSignin, minRounds: 8, maxRounds: 9, rewardCoins: 99 };
    const retry = await f.call('start');
    assert.equal(retry.session.id, sessionId); assert.equal(retry.session.rounds, value); assert.equal(retry.session.rewardCoins, 10);
    assert.equal(f.state.coinSignin.sessions.length, 1);
    t.mock.restoreAll();
  }
});
test('sessions are user-bound; order, forged client completion and premature claims are rejected', async () => {
  const f = fixture(), sessionId = await start(f), r = await round(f, sessionId);
  const payload = { sessionId, attemptId: r.attempt.id, stepId: r.attempt.steps[0].id };
  assert.equal((await service.execute(f.state, f.state.users[1], 'step', payload, f.deps)).status, 409);
  assert.equal((await f.call('step', { ...payload, stepId: r.attempt.steps[1].id })).status, 409);
  assert.equal((await f.call('claim', { sessionId })).status, 409);
  f.deps.verifier.verify = async () => null;
  const before = structuredClone(f.state.coinSignin);
  assert.equal((await f.call('step', { ...payload, isEnded: true, verified: true, receiptId: 'fake' })).status, 409);
  f.deps.verifier.verify = async () => { throw new Error('offline'); };
  assert.equal((await f.call('step', payload)).status, 503);
  assert.deepEqual(f.state.coinSignin, before);
});
test('new attempts reset partial groups, preserve whole rounds and enforce server cooldown', async () => {
  const f = fixture(), sessionId = await start(f);
  let r = await round(f, sessionId, 'round-key-001');
  assert.equal((await round(f, sessionId, 'round-key-001')).attempt.id, r.attempt.id);
  await f.call('step', { sessionId, attemptId: r.attempt.id, stepId: r.attempt.steps[0].id });
  const old = r.attempt.id;
  r = await round(f, sessionId, 'round-key-002');
  assert.notEqual(r.attempt.id, old); assert.equal(r.attempt.nextStep, 0); assert.equal(r.session.completedRounds, 0);
  r = await complete(f, r);
  assert.equal(r.session.completedRounds, 1);
  assert.equal((await f.call('round', { sessionId, idempotencyKey: 'round-key-003' })).status, 409);
  f.deps.now += 5000;
  r = await round(f, sessionId, 'round-key-003');
  assert.equal(r.session.completedRounds, 1); assert.equal(r.attempt.nextStep, 0);
  assert.equal((await f.call('start')).session.rounds, 2);
});
test('step and claim retries award independent coins exactly once, including after disabling', async () => {
  const f = fixture({ minRounds: 1, maxRounds: 1 }), beforeUser = structuredClone(f.user), beforePoints = structuredClone(f.state.pointLedger);
  const sessionId = await start(f);
  const r = await complete(f, await round(f, sessionId));
  const repeated = await f.call('step', { sessionId, attemptId: r.attempt.id, stepId: r.attempt.steps.at(-1).id });
  assert.equal(repeated.session.completedRounds, 1);
  f.state.config.coinSignin.enabled = false;
  const first = await f.call('claim', { sessionId }), second = await f.call('claim', { sessionId });
  assert.equal(first.balanceCoins, 10); assert.equal(second.balanceCoins, 10);
  assert.equal(f.state.coinSignin.ledger.length, 1); assert.deepEqual(f.user, beforeUser); assert.deepEqual(f.state.pointLedger, beforePoints);
  assert.equal(JSON.stringify(first).includes('receiptId'), false);
});
test('duplicate receipts cannot complete another step or user session', async () => {
  const f = fixture(); f.deps.verifier.verify = async () => ({ receiptId: 'unique-receipt' });
  const sessionId = await start(f), r = await round(f, sessionId);
  assert.equal((await f.call('step', { sessionId, attemptId: r.attempt.id, stepId: r.attempt.steps[0].id })).ok, true);
  assert.equal((await f.call('step', { sessionId, attemptId: r.attempt.id, stepId: r.attempt.steps[1].id })).status, 409);
  const other = { ...f, user: f.state.users[1] }; other.call = (a, i) => service.execute(f.state, other.user, a, i, f.deps);
  const otherId = await start(other), next = await round(other, otherId);
  assert.equal((await other.call('step', { sessionId: otherId, attemptId: next.attempt.id, stepId: next.attempt.steps[0].id })).status, 409);
});
test('concurrent step and claim requests cannot double mutate; persistence failure rolls back', async () => {
  const f = fixture({ minRounds: 1, maxRounds: 1, sequence: ['rewarded'] }), sessionId = await start(f), r = await round(f, sessionId);
  let resolve; f.deps.verifier.verify = () => new Promise(done => { resolve = done; });
  const p = { sessionId, attemptId: r.attempt.id, stepId: r.attempt.steps[0].id };
  const pending = f.call('step', p);
  assert.equal((await f.call('step', p)).status, 409);
  resolve({ receiptId: 'concurrent-one' }); assert.equal((await pending).session.completedRounds, 1);
  const before = structuredClone(f.state.coinSignin);
  await assert.rejects(f.call('claim', { sessionId }, { persist: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.deepEqual(f.state.coinSignin, before);
  const results = await Promise.all([f.call('claim', { sessionId }), f.call('claim', { sessionId })]);
  assert.ok(results.some(x => x.ok));
  assert.equal((await f.call('claim', { sessionId })).balanceCoins, 10);
  assert.equal(f.state.coinSignin.ledger.length, 1);
});
test('attempt expiry and Beijing midnight cannot award against old sessions', async () => {
  const f = fixture(), sessionId = await start(f), r = await round(f, sessionId);
  f.deps.now += 30 * 60000;
  assert.equal((await f.call('step', { sessionId, attemptId: r.attempt.id, stepId: r.attempt.steps[0].id })).status, 409);
  f.deps.now = Date.parse('2026-11-03T16:00:00Z');
  assert.equal(service.day(f.deps.now), '2026-11-04');
  assert.equal((await f.call('claim', { sessionId })).status, 409);
  assert.notEqual(await start(f), sessionId);
});
test('verification gateway requires HTTPS and exact identity binding, never client assertions', async t => {
  assert.equal(verifier.configured({}), false);
  assert.equal(verifier.configured({ SIGNIN_AD_VERIFIER_URL: 'http://example.test', SIGNIN_AD_VERIFIER_TOKEN: 'secret' }), false);
  const oldUrl = process.env.SIGNIN_AD_VERIFIER_URL, oldToken = process.env.SIGNIN_AD_VERIFIER_TOKEN;
  process.env.SIGNIN_AD_VERIFIER_URL = 'https://verifier.example.test/verify'; process.env.SIGNIN_AD_VERIFIER_TOKEN = 'test-only';
  t.after(() => { if (oldUrl === undefined) delete process.env.SIGNIN_AD_VERIFIER_URL; else process.env.SIGNIN_AD_VERIFIER_URL = oldUrl; if (oldToken === undefined) delete process.env.SIGNIN_AD_VERIFIER_TOKEN; else process.env.SIGNIN_AD_VERIFIER_TOKEN = oldToken; });
  const context = { userId: 'u1', attemptId: 'a1', stepId: 's1', adUnitId: 'ad1' };
  let response = { ...context, verified: true, receiptId: 'r1' };
  t.mock.method(globalThis, 'fetch', async (url, opts) => { assert.equal(opts.redirect, 'error'); assert.deepEqual(JSON.parse(opts.body), context); return { ok: true, json: async () => response }; });
  assert.deepEqual(await verifier.verify(context), { receiptId: 'r1' });
  for (const key of ['userId', 'attemptId', 'stepId', 'adUnitId', 'verified']) { response = { ...context, verified: true, receiptId: 'r1', [key]: 'forged' }; assert.equal(await verifier.verify(context), null); }
});
