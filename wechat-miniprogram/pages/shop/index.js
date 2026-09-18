const shopApi = require("../../utils/api");
const { request } = shopApi;
const resolveAssetUrl = shopApi.resolveAssetUrl || (value => value);
Page({
  data: { products: [], allProducts: [], category: "全部", search: "", categories: [] },
  onShow() { const entry = wx.getStorageSync("tgg_shop_entry"); if (entry) { this.setData(entry); wx.removeStorageSync("tgg_shop_entry"); } this.load(); },
  onUnload() { this.version = (this.version || 0) + 1; },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    this.setData({ allProducts: [], products: [], categories: [], error: "", loading: true });
    try { const rows = await request("/api/products"); const products = Array.isArray(rows) ? rows.map(item => ({ ...item, image: resolveAssetUrl(item.image) })) : []; if (version !== this.version) return; this.setData({ allProducts: products, categories: ["全部", "纯积分兑换", ...new Set(products.map(item => item.category).filter(Boolean))], error: "" }, () => this.filter()); }
    catch (error) { if (version === this.version) this.setData({ error: error.message }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  filter() { const search = String(this.data.search || "").trim(); this.setData({ products: this.data.allProducts.filter(item => item && String(item.name || "").trim() && (this.data.category === "全部" || (this.data.category === "纯积分兑换" ? item.purePointsOnly : item.category === this.data.category)) && String(item.name).includes(search)) }); },
  category(e) { this.setData({ category: e.currentTarget.dataset.category }, () => this.filter()); },
  search(e) { this.setData({ search: e.detail.value }, () => this.filter()); },
  open(e) { wx.navigateTo({ url: "/pages/product/index?id=" + encodeURIComponent(e.currentTarget.dataset.id) }); }
});
