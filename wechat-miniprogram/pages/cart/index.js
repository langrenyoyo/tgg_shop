const cartApi = require("../../utils/api");
const { request } = cartApi;
const resolveAssetUrl = cartApi.resolveAssetUrl || (value => value);
const cart = require("../../utils/cart");
Page({
  data: { items: [], error: "", loading: false },
  onShow() { this.load(); },
  onUnload() { this.version = (this.version || 0) + 1; },
  owner() { return wx.getStorageSync("tgg_user")?.id || "guest"; },
  canEdit() {
    if (this.ownerId !== this.owner()) { this.load(); return false; }
    return !this.data.loading && !this.data.error;
  },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    const owner = this.ownerId = this.owner();
    this.setData({ items: [], loading: true, error: "" });
    try {
      const products = await request("/api/products");
      if (version !== this.version || owner !== this.owner()) return;
      this.setData({ items: cart.read().map(item => { const product = products.find(p => p.id === item.productId) || null; return { ...item, product: product ? { ...product, image: resolveAssetUrl(product.image) } : null }; }), error: "" });
    } catch (error) { if (version === this.version && owner === this.owner()) this.setData({ error: error.message }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  select(e) {
    if (!this.canEdit()) return;
    const items = cart.read(); const item = items.find(row => row.productId === e.currentTarget.dataset.id);
    if (item) item.selected = !item.selected; cart.write(items); this.load();
  },
  quantity(e) {
    if (!this.canEdit()) return;
    const items = cart.read(); const item = items.find(row => row.productId === e.currentTarget.dataset.id);
    const delta = Number(e.currentTarget.dataset.delta);
    if (!item || ![-1, 1].includes(delta)) return;
    const quantity = Math.max(1, item.quantity + delta);
    const product = this.data.items.find(row => row.productId === item.productId)?.product;
    if (!Number.isSafeInteger(quantity) || (delta > 0 && (!product || !Number.isSafeInteger(product.stock) || quantity > product.stock))) return wx.showToast({ title: "库存不足或商品已下架", icon: "none" });
    item.quantity = quantity;
    cart.write(items); this.load();
  },
  remove(e) { if (!this.canEdit()) return; cart.write(cart.read().filter(row => row.productId !== e.currentTarget.dataset.id)); this.load(); },
  checkout() {
    if (!wx.getStorageSync("tgg_token")) return wx.navigateTo({ url: "/pages/login/index" });
    if (!this.canEdit()) return;
    const displayed = this.data.items.map(({ productId, quantity, selected }) => ({ productId, quantity, selected }));
    const current = cart.read().map(({ productId, quantity, selected }) => ({ productId, quantity, selected }));
    if (JSON.stringify(displayed) !== JSON.stringify(current)) { this.load(); return wx.showToast({ title: "购物车已更新，请重新确认", icon: "none" }); }
    const items = this.data.items.filter(item => item.selected);
    if (!items.length) return wx.showToast({ title: "请选择商品", icon: "none" });
    if (items.some(item => !item.product || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.product.stock) || item.quantity > item.product.stock)) return wx.showToast({ title: "部分商品已下架或库存不足", icon: "none" });
    cart.writeCheckout(items.map(({ productId, quantity }) => ({ productId, quantity })), true);
    wx.navigateTo({ url: "/pages/checkout/index" });
  }
});
