const shopApi = require("../../utils/api");
const productCart = require("../../utils/product-cart");
const { request } = shopApi;
const resolveAssetUrl = shopApi.resolveAssetUrl || (value => value);
const PAGE_SIZE = 10;

Page({
  data: { products: [], category: "全部", search: "", categories: ["全部"], categoryCollapsed: false, total: 0, hasMore: false, loadingMore: false, moreError: "", scrollTop: 0 },
  onShow() {
    this.disposed = false;
    this.setData({ navigating: false, cartQuantities: productCart.quantities() });
    const entry = wx.getStorageSync("tgg_shop_entry");
    const returning = this.returningFromProduct;
    this.returningFromProduct = false;
    if (entry) {
      this.setData({ category: entry.search ? "全部" : entry.category || "全部", search: entry.search || "" });
      wx.removeStorageSync("tgg_shop_entry");
    }
    // Keep the scroll-view and its loaded pages mounted when detail closes.
    if (!entry && returning && this.loaded && this.ownerId === this.owner()) return;
    return this.load();
  },
  owner() { return wx.getStorageSync("tgg_user")?.id || "guest"; },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; },
  load() {
    this.ownerId = this.owner();
    this.loaded = false;
    this.page = 0;
    this.version = (this.version || 0) + 1;
    // Reset even if the last programmatic scrollTop was already zero.
    this.setData({ scrollTop: this.productScrollTop || 0 }, () => this.setData({ scrollTop: 0 }));
    this.productScrollTop = 0;
    this.setData({ products: [], total: 0, hasMore: false, error: "", moreError: "", loading: true, loadingMore: false, cartQuantities: productCart.quantities() });
    return this.fetchPage(1, this.version);
  },
  async fetchPage(page, version) {
    const owner = this.ownerId;
    const active = () => !this.disposed && version === this.version && owner === this.owner();
    const query = `page=${page}&pageSize=${PAGE_SIZE}&category=${encodeURIComponent(this.data.category)}&search=${encodeURIComponent(String(this.data.search || "").trim())}`;
    try {
      const result = await request("/api/products?" + query);
      if (!active()) return;
      const rows = result.items.filter(item => item && item.id && String(item.name || "").trim()).map(item => ({ ...item, image: resolveAssetUrl(item.image) }));
      const existing = new Set(this.data.products.map(item => item.id));
      const products = page === 1 ? rows : this.data.products.concat(rows.filter(item => !existing.has(item.id)));
      this.page = page;
      this.loaded = true;
      this.setData({ products, total: result.total, categories: [...new Set(["全部", ...(result.categories || [])])], hasMore: result.hasMore, error: "", moreError: "" });
    } catch (error) {
      if (active()) this.setData(page === 1 ? { error: error.message } : { moreError: error.message });
    } finally {
      if (active()) this.setData({ loading: false, loadingMore: false });
    }
  },
  loadMore() {
    if (this.disposed || this.data.loading || this.data.loadingMore || !this.data.hasMore || this.ownerId !== this.owner()) return;
    this.setData({ loadingMore: true, moreError: "" });
    return this.fetchPage(this.page + 1, this.version);
  },
  onProductScroll(e) { this.productScrollTop = e.detail.scrollTop; },
  category(e) { this.setData({ category: e.currentTarget.dataset.category || "全部", search: "" }); return this.load(); },
  toggleCategoryMenu() { this.setData({ categoryCollapsed: !this.data.categoryCollapsed }); },
  changeCart(e) { productCart.change(this, this.data.products.find(item => item.id === e.currentTarget.dataset.id), Number(e.currentTarget.dataset.delta)); },
  buyGift(e) { productCart.buyGift(this, this.data.products.find(item => item.id === e.currentTarget.dataset.id)); },
  search(e) { this.setData({ search: e.detail.value, category: "全部" }); return this.load(); },
  open(e) {
    this.returningFromProduct = true;
    wx.navigateTo({ url: "/pages/product/index?id=" + encodeURIComponent(e.currentTarget.dataset.id), fail: () => { this.returningFromProduct = false; } });
  }
});
