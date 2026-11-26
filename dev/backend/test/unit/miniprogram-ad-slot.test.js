const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../../wechat-miniprogram/components/ad-slot/index.js'), 'utf8');
function setup(platform = 'devtools', request = async () => ({ coinSignin: { bannerAdUnitId: 'adunit-banner001', feedAdUnitId: 'adunit-feed0001' } })) {
  let definition;const warnings = [];
  vm.runInNewContext(source, { Component: value => { definition = value; }, Date, Promise,
    wx: { getDeviceInfo: () => ({ platform }) }, console: { warn: (...args) => warnings.push(args) },
    require: () => ({ request }) });
  const instance = { ...definition.methods, data: { ...definition.data, kind: 'banner' }, setData(values) { Object.assign(this.data, values); } };
  definition.lifetimes.attached.call(instance);
  return { instance, definition, warnings };
}
test('banner fetches the real configured ID and exposes safe diagnostics only to developer tools', async () => {
  for (const platform of ['devtools', 'android', 'ios']) {
    const { instance, warnings } = setup(platform);await new Promise(setImmediate);
    assert.equal(instance.data.unitId, 'adunit-banner001');assert.equal(instance.data.debug, platform === 'devtools');
    for (const code of [1002,1004,1005,1008]) {
      instance.failed({ detail: { errCode: code, errMsg: 'untrusted provider message' } });
      assert.equal(instance.data.failed, true);assert.ok(instance.data.diagnostic.startsWith(code + '：'));
      assert.equal(instance.data.diagnostic.includes('untrusted'), false);
    }
    assert.equal(warnings.length, platform === 'devtools' ? 4 : 0);
    instance.loaded();assert.equal(instance.data.failed, false);assert.equal(instance.data.diagnostic, '');
  }
});
test('a failed config request can recover when the page is shown again, and detached components ignore responses', async () => {
  let fail = true;
  const { instance, definition } = setup('devtools', async () => { if (fail) throw Error('offline');return { coinSignin: { bannerAdUnitId: 'adunit-recovered' } }; });
  await new Promise(setImmediate);assert.match(instance.data.diagnostic, /配置加载失败/);
  fail = false;definition.pageLifetimes.show.call(instance);await new Promise(setImmediate);
  assert.equal(instance.data.unitId, 'adunit-recovered');
  let resolve;
  const detached = setup('devtools', () => new Promise(done => { resolve = done; }));
  detached.definition.lifetimes.detached.call(detached.instance);
  resolve({ coinSignin: { bannerAdUnitId: 'adunit-stale' } });await new Promise(setImmediate);
  assert.equal(detached.instance.data.unitId, '');
});
