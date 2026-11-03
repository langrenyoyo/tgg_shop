const { request } = require("../../utils/api");
Page({
  data: { user: null, pointsRequired: 0, payments: [], config: {}, busy: false, loading: false, error: "", needLogin: false },
  onShow() { this.load(); },
  onUnload() { this.version = (this.version || 0) + 1; this.ownerId = null; },
  sameOwner(owner = this.ownerId) { return Boolean(owner && owner === this.ownerId && owner === wx.getStorageSync("tgg_user")?.id && wx.getStorageSync("tgg_token")); },
  canAct() {
    if (!this.sameOwner()) { this.load(); return false; }
    return !this.data.busy && !this.data.loading && !this.data.error && Boolean(this.data.user);
  },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (owner !== this.ownerId) this.key = null;
    this.ownerId = owner;
    this.setData({ user: null, pointsRequired: 0, payments: [], config: {}, loading: false, error: "", needLogin: false });
    if (!this.sameOwner(owner)) { this.setData({ error: "请登录后查看会员信息", needLogin: true }); return; }
    this.setData({ loading: true });
    try {
      const [user, config, payments] = await Promise.all([request("/api/me"), request("/api/config"), request("/api/payments")]);
      if (version !== this.version) return;
      if (!this.sameOwner(owner)) {
        const currentUser = wx.getStorageSync("tgg_user");
        const needLogin = !currentUser || !wx.getStorageSync("tgg_token");
        this.setData({ error: needLogin ? "登录状态已失效，请重新登录" : "账号已变更，请刷新会员页", needLogin });
        return;
      }
      this.setData({ user, config, pointsRequired: config.membershipMonthlyPoints || 0, payments: payments.filter(payment => payment.payScene === "member_open" && payment.status === "pending"), error: "" });
    }
    catch (error) { if (version === this.version) this.setData({ error: error.message, needLogin: error.statusCode === 401 }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  login() { wx.navigateTo({ url: "/pages/login/index" }); },
  goGiftShop() {
    if (this.data.busy) return;
    wx.setStorageSync("tgg_shop_entry", { category: "买商品送会员", search: "", categoryCollapsed: false });
    wx.switchTab({ url: "/pages/shop/index", fail: () => wx.showToast({ title: "专区打开失败，请重试", icon: "none" }) });
  },
  async queryPayment(e) {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    const payment = this.data.payments.find(item => item.payNo === e.currentTarget.dataset.payNo);
    if (!payment) return;
    this.setData({ busy: true });
    try {
      if (this.data.config.testBypassEnabled) {
        const payments = await request("/api/payments");
        if (!this.sameOwner(owner)) return;
        const current = payments.find(item => item.payNo === payment.payNo);
        if (current?.status === "paid") this.key = null;
        wx.showToast({ title: current?.status === "paid" ? "会员已开通" : current?.status === "pending" ? "历史订单待核对，请联系客服" : "订单状态已更新", icon: "none" });
      } else if (payment.metadata?.lfwin?.providerOrderNo || payment.metadata?.lfwin?.submissionState) {
        const result = await request("/api/payments/" + encodeURIComponent(payment.payNo) + "/lfwin/query", { method: "POST", data: {} });
        if (!this.sameOwner(owner)) return;
        if (result.payment?.status === "paid") this.key = null;
        wx.showToast({ title: result.payment?.status === "paid" ? "会员已开通" : "尚未确认付款", icon: "none" });
      } else wx.showToast({ title: "此历史订单未发起付款，请联系客服处理", icon: "none" });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { if (this.sameOwner(owner)) await this.load(); this.setData({ busy: false }); }
  },
  async subscribe(e = {}) {
    const paymentMode = e.currentTarget?.dataset?.mode;
    if (paymentMode !== "pure_points") return this.goGiftShop();
    if (!this.canAct() || this.data.payments.length) return;
    const owner = this.ownerId;
    this.setData({ busy: true });
    try {
      this.key ||= "member:" + Date.now() + ":" + Math.random().toString(36).slice(2);
      const payment = await request("/api/member/payments", { method: "POST", data: { months: 1, paymentMode, idempotencyKey: this.key } });
      if (!this.sameOwner(owner)) return;
      if (payment.status !== "paid" || Number(payment.amount) !== 0) throw new Error("积分开通结果待核对，请刷新或联系客服");
      this.key = null;
      wx.showToast({ title: "会员已开通" });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { if (this.sameOwner(owner)) await this.load(); this.setData({ busy: false }); }
  }
});
