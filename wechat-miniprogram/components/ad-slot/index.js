const { request } = require('../../utils/api');
let pending, cached, loadedAt = 0;
const messages = {
  1000: '微信广告服务暂不可用', 1001: '广告参数错误', 1002: '广告位无效、类型不匹配或不属于当前小程序',
  1003: '微信广告内部错误', 1004: '当前没有适合的广告', 1005: '广告位审核中',
  1006: '广告位审核未通过', 1007: '广告能力已封禁', 1008: '广告位已关闭'
};
function devtools() {
  try { return (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform === 'devtools'; }
  catch { return false; }
}
function config() {
  if (cached && Date.now() - loadedAt < 60000) return Promise.resolve(cached);
  if (!pending) pending = request('/api/config').then(value => {
    cached = value.coinSignin || {}; loadedAt = Date.now(); return cached;
  }).finally(() => { pending = null; });
  return pending;
}
Component({
  properties: { kind: { type: String, value: 'banner' }, flushTop: { type: Boolean, value: false } },
  data: { unitId: '', failed: false, debug: false, diagnostic: '' },
  lifetimes: {
    attached() {
      this.alive = true;
      this.setData({ debug: devtools() });
      this.loadConfig();
    },
    detached() { this.alive = false; }
  },
  pageLifetimes: { show() { if (this.alive && !this.data.unitId) this.loadConfig(); } },
  methods: {
    loadConfig() {
      config().then(value => {
        if (!this.alive) return;
        const unitId = value[this.data.kind === 'feed' ? 'feedAdUnitId' : 'bannerAdUnitId'] || '';
        this.setData({ unitId, diagnostic: unitId ? '等待微信返回广告' : '服务器未配置此广告位' });
      }).catch(() => {
        if (this.alive) this.setData({ diagnostic: '广告位配置加载失败，请检查 Network 中 /api/config 请求' });
      });
    },
    failed(event) {
      const code = Number(event?.detail?.errCode);
      const diagnostic = `${Number.isFinite(code) ? code : 'unknown'}：${messages[code] || '广告加载失败，请使用手机预览并核对流量主广告位状态'}`;
      this.setData({ failed: true, diagnostic });
      if (this.data.debug) console.warn('[tgg-ad]', this.data.kind, this.data.unitId, diagnostic);
    },
    loaded() { this.setData({ failed: false, diagnostic: '' }); }
  }
});
