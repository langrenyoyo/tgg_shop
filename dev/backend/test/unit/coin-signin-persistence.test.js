process.env.TGG_STORE_MODE = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
for (const driver of ['json', 'sqlite']) test(`${driver} restart preserves sign-in snapshots, receipts and exactly one coin award`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgg-coin-signin-'));
  const env = { ...process.env, TGG_STORE_MODE: '', TGG_STORE_DRIVER: driver, TGG_STORE_FILE: path.join(dir, 'store.json'), TGG_SQLITE_FILE: path.join(dir, 'store.sqlite'), NODE_NO_WARNINGS: '1' };
  const common = `const assert = require('node:assert/strict'); const store = require('./src/data/store'); const service = require('./src/services/coin-signin-service'); const rules = require('./src/services/coin-signin-config');
    const now = Date.parse('2026-11-03T04:00:00Z'); const verifier = {configured:()=>true,verify:async c=>({receiptId:c.stepId})};
    async function run() { await store.whenReady(); const state = store.getState(), user = state.users[0];
    const call = (a,i)=>service.execute(state,user,a,i,{now,verifier}); `;
  const write = `state.config.coinSignin={...structuredClone(rules.defaults),enabled:true,minRounds:1,maxRounds:1,sequence:['rewarded'],rewardedAdUnitId:'adunit-rewarded01'};
    const started=await call('start',{}), sessionId=started.session.id;
    const r=await call('round',{sessionId,idempotencyKey:'persist-key-001'});
    assert.equal((await call('step',{sessionId,attemptId:r.attempt.id,stepId:r.attempt.steps[0].id})).session.completedRounds,1);
    assert.equal((await call('claim',{sessionId})).balanceCoins,10);`;
  const read = `const status=service.status(state,user,now,verifier); assert.equal(status.session.claimed,true); assert.equal(status.balanceCoins,10);
    assert.equal(state.coinSignin.sessions[0].receipts.length,1); assert.equal(state.coinSignin.sessions[0].rounds,1);
    assert.equal((await call('claim',{sessionId:status.session.id})).balanceCoins,10); assert.equal(state.coinSignin.ledger.length,1);`;
  try {
    for (const script of [write, read]) execFileSync(process.execPath, ['--no-warnings', '-e', common + script + `} run().catch(e=>{console.error(e);process.exit(1)});`], { cwd: path.resolve(__dirname, '../..'), env, stdio: 'pipe' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PostgreSQL snapshot reload preserves claimed sign-in and receipts', async () => {
  const vm = require('node:vm'), database = require('pg-mem').newDb({ noAstCoverageCheck: true });
  const adapter = database.adapters.createPg();
  function instance() {
    const context = { module: { exports: {} }, process: { env: { TGG_PG_URL: 'postgres://test', TGG_PG_MEM: '1' } }, require(name) {
      if (name === 'pg') return adapter;
      if (name === './seed') return require('../../src/data/seed');
      if (name === './state-normalizer') return require('../../src/data/state-normalizer');
      throw new Error(name);
    } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/data/pg-store.js'), 'utf8'), context);
    return context.module.exports;
  }
  const writer = instance(), reader = instance(), service = require('../../src/services/coin-signin-service');
  try {
    const state = await writer.initPgState(), user = state.users[0];
    state.config.coinSignin = { ...structuredClone(require('../../src/services/coin-signin-config').defaults), enabled: true,
      minRounds: 1, maxRounds: 1, sequence: ['rewarded'], rewardedAdUnitId: 'adunit-rewarded01' };
    const deps = { now: Date.parse('2026-11-03T04:00:00Z'), verifier: { configured: () => true, verify: async c => ({ receiptId: c.stepId }) }, persist: () => writer.savePgState(state) };
    const call = (action, input) => service.execute(state, user, action, input, deps);
    const sessionId = (await call('start', {})).session.id;
    const round = await call('round', { sessionId, idempotencyKey: 'postgres-round-001' });
    await call('step', { sessionId, attemptId: round.attempt.id, stepId: round.attempt.steps[0].id });
    assert.equal((await call('claim', { sessionId })).balanceCoins, 10);
    const durable = await reader.initPgState();
    assert.equal(durable.coinSignin.ledger.length, 1);
    assert.equal(durable.coinSignin.sessions[0].receipts.length, 1);
    assert.equal(service.status(durable, durable.users[0], deps.now, deps.verifier).session.claimed, true);
    const retry = await service.execute(durable, durable.users[0], 'claim', { sessionId }, { ...deps, persist: () => reader.savePgState(durable) });
    assert.equal(retry.balanceCoins, 10); assert.equal(durable.coinSignin.ledger.length, 1);
  } finally { await Promise.all([writer.closePgPool(), reader.closePgPool()]); }
});
