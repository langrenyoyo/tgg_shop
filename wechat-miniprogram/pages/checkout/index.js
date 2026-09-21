const { request } = require("../../utils/api");
const cart = require("../../utils/cart");
Page({
  data: { items: [], modes: [], modeIndex: 0, sites: [], siteIndex: 0, addresses: [], defaultAddress: null, fulfillmentType: "pickup", deliveryAddress: "", config: {}, busy: false, loading: true, fulfillmentError: "", error: "" },
  onLoad() { this.idempotencyKey = cart.checkoutIdempotencyKey(); this.ownerId = wx.getStorageSync("tgg_user")?.id; this.setData({ pending: cart.readCheckoutAttempt() }); this.load(); },
  onShow() { if (this.shown) this.load(); this.shown = true; },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; },
  active(version, owner) { return !this.disposed && version === this.version && owner === wx.getStorageSync("tgg_user")?.id; },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    const owner = this.ownerId;
    this.setData({ loading: true, error: "", items: [], user: null, modes: [], sites: [], addresses: [], defaultAddress: null, config: {}, estimatedPoints: 0, estimatedCash: "0.00" });
    if (!owner || owner !== wx.getStorageSync("tgg_user")?.id) {
      this.setData({ loading: false, pending: null, deliveryAddress: "", error: "账号已变更，请重新打开结算页" });
      return;
    }
    try {
      const [user, config, sites, products] = await Promise.all([request("/api/me"), request("/api/config"), request("/api/pickup-sites"), request("/api/products")]);
      let addresses = [];
      try { const loadedAddresses = await request("/api/addresses"); addresses = Array.isArray(loadedAddresses) ? loadedAddresses : []; } catch { addresses = []; }
      if (!this.active(version, owner)) return;
      if (user.id !== owner || cart.checkoutIdempotencyKey() !== this.idempotencyKey) throw new Error("结算信息已变更，请重新打开结算页");
      const items = cart.readCheckout().map(item => ({ ...item, product: products.find(p => p.id === item.productId) }));
      if (!items.length || items.some(item => !item.product)) throw new Error("请选择有效商品");
      const modes = [];
      if (items.every(item => item.product.supportsPoints)) modes.push({ id: "pure_points", label: "纯积分兑换" });
      if (user.isMember && items.every(item => item.product.supportsCash && !item.product.purePointsOnly)) modes.push({ id: "cash", label: "会员现金购买" });
      if (user.isMember && items.every(item => item.product.supportsPoints && !item.product.purePointsOnly)) modes.push({ id: "points_plus_cash", label: "积分不足现金补差" });
      const fulfillmentType = config.pickupEnabled && sites.length ? "pickup" : config.deliveryEnabled ? "delivery" : "pickup";
      const defaultAddress = addresses.find(item => item.isDefault) || addresses[0] || null;
      this.setData({ items, user, config, sites, addresses, defaultAddress, modes, modeIndex: 0, siteIndex: 0, fulfillmentType, deliveryAddress: defaultAddress ? [defaultAddress.receiverName, defaultAddress.mobile, defaultAddress.province, defaultAddress.city, defaultAddress.district, defaultAddress.detail].filter(Boolean).join(" ") : "", error: "" }, () => this.calculate());
    } catch (error) { if (this.active(version, owner)) this.setData({ error: error.message }); }
    finally { if (this.active(version, owner)) this.setData({ loading: false }); }
  },
  calculate() {
    const mode = this.data.modes[this.data.modeIndex]?.id;
    const points = this.data.items.reduce((sum, item) => sum + (item.product.pointsPrice || 0) * item.quantity, 0);
    const goodsCash = this.data.items.reduce((sum, item) => sum + (item.product.cashPrice || 0) * item.quantity, 0);
    const usedPoints = mode === "cash" ? 0 : mode === "points_plus_cash" ? Math.min(this.data.user.points, points) : points;
    let cash = mode === "cash" ? goodsCash : mode === "points_plus_cash" ? Math.max(0, points - usedPoints) / 10 : 0;
    if (mode !== "pure_points" && this.data.fulfillmentType === "delivery" && this.data.config.deliveryFeeEnabled) cash += Number(this.data.config.deliveryFee || 0);
    this.setData({ estimatedPoints: usedPoints, estimatedCash: cash.toFixed(2), fulfillmentError: this.validateFulfillment() });
  },
  validateFulfillment() {
    const { config, fulfillmentType, sites, siteIndex } = this.data;
    if (!config.pickupEnabled && !config.deliveryEnabled) return "暂未开放自提或配送，请稍后再试";
    if (fulfillmentType === "pickup" && (!config.pickupEnabled || !sites[siteIndex])) return "暂无可用自提点，请选择送货上门或稍后再试";
    if (fulfillmentType === "delivery" && !config.deliveryEnabled) return "送货上门暂未开放";
    return "";
  },
  mode(e) { if (!this.data.busy && !this.data.pending) this.setData({ modeIndex: Number(e.detail.value) }, () => this.calculate()); },
  site(e) { if (!this.data.busy && !this.data.pending) this.setData({ siteIndex: Number(e.detail.value) }, () => this.calculate()); },
  fulfillment(e) { if (!this.data.busy && !this.data.pending) this.setData({ fulfillmentType: e.detail.value }, () => this.calculate()); },
  address(e) { if (!this.data.busy && !this.data.pending) this.setData({ deliveryAddress: e.detail.value }); },
  openAddress() { wx.navigateTo({ url: "/pages/address/index" }); },
  async submit() {
    if (this.disposed || this.data.busy || this.data.loading || (this.data.error && !this.data.pending)) return;
    if (!this.ownerId || wx.getStorageSync("tgg_user")?.id !== this.ownerId) return wx.showToast({ title: "账号已变更，请重新结算", icon: "none" });
    if (cart.checkoutIdempotencyKey() !== this.idempotencyKey) return wx.showToast({ title: "结算商品已变更，请重新打开结算页", icon: "none" });
    this.setData({ busy: true });
    try {
      let payload = this.data.pending;
      if (!payload) {
      const mode = this.data.modes[this.data.modeIndex]?.id;
      if (!mode) throw new Error("当前商品没有可用支付方式，请查看会员权益");
      const fulfillmentError = this.validateFulfillment();
      if (fulfillmentError) throw new Error(fulfillmentError);
      if (this.data.fulfillmentType === "delivery" && !this.data.deliveryAddress.trim()) throw new Error("请填写收货人、电话和完整地址");
      payload = {
        items: this.data.items.map(({ productId, quantity }) => ({ productId, quantity })),
        paymentMode: mode, fulfillmentType: this.data.fulfillmentType,
        pickupSiteId: this.data.sites[this.data.siteIndex]?.id,
        deliveryAddress: this.data.deliveryAddress.trim(), idempotencyKey: this.idempotencyKey
      };
      cart.writeCheckoutAttempt(this.idempotencyKey, payload);
      this.setData({ pending: payload });
      }
      const order = await request("/api/orders", { method: "POST", data: payload });
      if (this.disposed || wx.getStorageSync("tgg_user")?.id !== this.ownerId) return;
      cart.completeCheckout(this.idempotencyKey);
      wx.redirectTo({ url: "/pages/order-detail/index?id=" + encodeURIComponent(order.id) });
    } catch (error) {
      if (this.disposed || wx.getStorageSync("tgg_user")?.id !== this.ownerId) return;
      if (error.statusCode === 400 && wx.getStorageSync("tgg_user")?.id === this.ownerId && cart.checkoutIdempotencyKey() === this.idempotencyKey) {
        cart.writeCheckoutAttempt(this.idempotencyKey, null);
        this.setData({ pending: null });
      }
      wx.showToast({ title: error.message, icon: "none" });
    }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  }
});
