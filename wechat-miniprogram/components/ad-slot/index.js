const { request } = require('../../utils/api');
let pending, cached, loadedAt = 0;
function config() {
  if (cached && Date.now() - loadedAt < 60000) return Promise.resolve(cached);
  if (!pending) pending = request('/api/config').then(value => {
    cached = value.coinSignin || {}; loadedAt = Date.now(); return cached;
  }).finally(() => { pending = null; });
  return pending;
}
Component({
  properties: { kind: { type: String, value: 'banner' } },
  data: { unitId: '', failed: false },
  lifetimes: {
    attached() {
      this.alive = true;
      config().then(value => { if (this.alive) this.setData({ unitId: value[this.data.kind === 'feed' ? 'feedAdUnitId' : 'bannerAdUnitId'] || '' }); }).catch(() => {});
    },
    detached() { this.alive = false; }
  },
  methods: {
    failed() { this.setData({ failed: true }); },
    loaded() { this.setData({ failed: false }); }
  }
});
