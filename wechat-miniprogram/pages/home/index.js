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
  openBanner() {
    const productId = this.data.home?.bannerProduct?.id;
    if (productId) return this.openProduct({ currentTarget: { dataset: { id: productId } } });
    this.goShop();
  },
  openPromotion(e) {
    const page = e.currentTarget.dataset.page;
    if (page === "membership") return this.goMembership();
    if (page === "pointsExchange") return this.goExchange();
    if (page === "signin") return this.goSignin();
    if (page === "invite") return this.goInvite();
    if (page === "earn") return this.goTasks();
    this.goShop();
  },
  goExchange() { wx.setStorageSync("tgg_shop_entry", { category: "纯积分兑换", search: "" }); this.goShop(); },
  goCategory(e) {
    const category = String(e.currentTarget.dataset.category || "").trim();
    if (!category) return;
    wx.setStorageSync("tgg_shop_entry", { category, search: "" });
    this.goShop();
  },
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

function emptyHome() { return { user: {}, pickupSite: {}, categories: [], categoryShortcuts: [], banners: [{ title: "时令鲜果季", subtitle: "每日新鲜到家" }], recommendProducts: [] }; }
function normalizeHome(home) {
  const value = home && typeof home === "object" && !Array.isArray(home) ? home : {};
  const banners = Array.isArray(value.banners) ? value.banners.filter(item => item && typeof item === "object") : [];
  if (!banners.length) banners.push({ title: "时令鲜果季", subtitle: "每日新鲜到家" });
  const products = Array.isArray(value.recommendProducts) ? value.recommendProducts.filter(item => item && item.id && String(item.name || "").trim()) : [];
  const categoryDefaults = [
    { name: "水果", category: "水果", key: "fruit", icon: "/assets/icons/category-fruit.png" },
    { name: "蔬菜", category: "蔬菜", key: "vegetable", icon: "/assets/icons/category-vegetable.png" },
    { name: "日用", category: "日用", key: "daily", icon: "/assets/icons/category-daily.png" },
    { name: "零食", category: "零食", key: "snack", icon: "/assets/icons/category-snack.png" },
    { name: "饮料", category: "饮料", key: "drink", icon: "/assets/icons/category-drink.png" }
  ];
  const categories = (Array.isArray(value.categoryShortcuts) ? value.categoryShortcuts : Array.isArray(value.categories) ? value.categories : categoryDefaults).map(item => typeof item === "string" ? { name: item, category: item, key: item, icon: "" } : item).filter(item => item && String(item.name || "").trim() && String(item.category || item.name || "").trim()).slice(0, 8);
  const resolvedCategories = categories.map(item => ({ ...item, icon: categoryDefaults.some(entry => entry.icon === item.icon) ? item.icon : resolveAssetUrl(item.icon || "") }));
  return { ...value, pickupSite: value.pickupSite && typeof value.pickupSite === "object" ? value.pickupSite : {}, categories: resolvedCategories, categoryShortcuts: resolvedCategories, banners, bannerImage: resolveAssetUrl(value.bannerImage || banners[0].image || ""), bannerProduct: value.bannerProduct ? { ...value.bannerProduct, image: resolveAssetUrl(value.bannerProduct.image) } : null, recommendProducts: products.map(item => ({ ...item, image: resolveAssetUrl(item.image) })), user: value.user && typeof value.user === "object" ? value.user : {} };
}
