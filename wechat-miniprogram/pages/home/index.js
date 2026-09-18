const homeApi = require("../../utils/api");
const { request } = homeApi;
const resolveAssetUrl = homeApi.resolveAssetUrl || (value => value);

Page({
  data: {
    home: { user: {}, pickupSite: {}, banners: [{ title: "时令鲜果季", subtitle: "每日新鲜到家" }], recommendProducts: [] }
  },

  onShow() {
    this.load();
  },
  onUnload() { this.version = (this.version || 0) + 1; },

  async load() {
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    const active = () => version === this.version && owner === wx.getStorageSync("tgg_user")?.id;
    this.setData({ home: emptyHome(), error: "", loading: true });
    try {
      const home = await request("/api/home");
      if (!active()) return;
      this.setData({ home: normalizeHome(home), error: "" });
    } catch (error) {
      if (active()) this.setData({ error: error.message });
    } finally { if (version === this.version) this.setData({ loading: false }); }
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },
  goShop() { wx.switchTab({ url: "/pages/shop/index" }); },
  goExchange() { wx.setStorageSync("tgg_shop_entry", { category: "纯积分兑换", search: "" }); this.goShop(); },
  search(e) { wx.setStorageSync("tgg_shop_entry", { category: "全部", search: e.detail.value }); this.goShop(); },
  goMembership() { wx.navigateTo({ url: "/pages/membership/index" }); },
  goSignin() { wx.navigateTo({ url: "/pages/signin/index" }); },
  goInvite() { wx.navigateTo({ url: "/pages/invite/index" }); },

  goTasks() {
    wx.switchTab({ url: "/pages/tasks/index" });
  },

  openProduct(e) {
    wx.navigateTo({ url: `/pages/product/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` });
  }
});

function emptyHome() { return { user: {}, pickupSite: {}, banners: [{ title: "时令鲜果季", subtitle: "每日新鲜到家" }], recommendProducts: [] }; }
function normalizeHome(home) {
  const value = home && typeof home === "object" && !Array.isArray(home) ? home : {};
  const banners = Array.isArray(value.banners) ? value.banners.filter(item => item && typeof item === "object") : [];
  if (!banners.length) banners.push({ title: "时令鲜果季", subtitle: "每日新鲜到家" });
  const products = Array.isArray(value.recommendProducts) ? value.recommendProducts.filter(item => item && item.id && String(item.name || "").trim()) : [];
  return { ...value, pickupSite: value.pickupSite && typeof value.pickupSite === "object" ? value.pickupSite : {}, banners, recommendProducts: products.map(item => ({ ...item, image: resolveAssetUrl(item.image) })), user: value.user && typeof value.user === "object" ? value.user : {} };
}
