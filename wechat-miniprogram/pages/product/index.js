const productApi = require("../../utils/api");
const { request } = productApi;
const resolveAssetUrl = productApi.resolveAssetUrl || (value => value);
const cart = require("../../utils/cart");
Page({
  data: { product: null, error: "", loading: false, navigating: false },
  onLoad(query) { this.id = query.id; },
  onShow() { this.disposed = false; this.setData({ navigating: false }); this.load(); },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    this.setData({ product: null, error: "", loading: false });
    if (!this.id) { this.setData({ error: "缺少商品编号，请从商城重新进入" }); return; }
    this.setData({ loading: true });
    try {
      const product = await request("/api/products/" + encodeURIComponent(this.id));
      if (!product || String(product.id) !== String(this.id)) throw new Error("商品信息不匹配，请重新加载");
      if (!this.disposed && version === this.version) this.setData({ product: { ...product, image: resolveAssetUrl(product.image) }, error: "" });
    } catch (error) { if (!this.disposed && version === this.version) this.setData({ error: error.message }); }
    finally { if (!this.disposed && version === this.version) this.setData({ loading: false }); }
  },
  canPurchase() {
    if (this.disposed || this.data.loading || this.data.navigating || this.data.error || !this.data.product) return false;
    const product = this.data.product;
    if (product.status !== "on" || !Number.isSafeInteger(product.stock) || product.stock < 1) { wx.showToast({ title: "商品已下架或库存不足", icon: "none" }); return false; }
    return true;
  },
  open(url) {
    this.setData({ navigating: true });
    wx.navigateTo({ url, fail: () => { if (!this.disposed) this.setData({ navigating: false }); wx.showToast({ title: "页面打开失败，请重试", icon: "none" }); } });
  },
  add() {
    if (!this.canPurchase()) return;
    try { cart.add(this.data.product); wx.showToast({ title: "已加入购物车" }); }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
  },
  buy() {
    if (!this.canPurchase()) return;
    if (!wx.getStorageSync("tgg_token")) return this.open("/pages/login/index");
    cart.writeCheckout([{ productId: this.id, quantity: 1 }]);
    this.open("/pages/checkout/index");
  },
  cart() { wx.switchTab({ url: "/pages/cart/index" }); }
});
