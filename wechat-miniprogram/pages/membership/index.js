const { request } = require("../../utils/api");
const { pay } = require("../../utils/payment");
Page({
  data: { user: null, price: 0, payments: [], busy: false, loading: false, error: "" },
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
    this.setData({ user: null, price: 0, payments: [], loading: false, error: "" });
    if (!this.sameOwner(owner)) { this.setData({ error: "请登录后查看会员信息" }); return; }
    this.setData({ loading: true });
    try {
      const [user, config, payments] = await Promise.all([request("/api/me"), request("/api/config"), request("/api/payments")]);
      if (version !== this.version || !this.sameOwner(owner)) return;
      this.setData({ user, price: config.membershipMonthlyPrice, payments: payments.filter(payment => payment.payScene === "member_open" && payment.status === "pending"), error: "" });
    }
    catch (error) { if (version === this.version && this.sameOwner(owner)) this.setData({ error: error.message }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  login() { wx.navigateTo({ url: "/pages/login/index" }); },
  async resume(e) {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    const payment = this.data.payments.find(item => item.payNo === e.currentTarget.dataset.payNo);
    if (!payment) return;
    this.setData({ busy: true });
    try { await pay(payment); if (!this.sameOwner(owner)) return; this.key = null; wx.showToast({ title: "会员已开通" }); }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { if (this.sameOwner(owner)) await this.load(); this.setData({ busy: false }); }
  },
  async queryPayment(e) {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    const payment = this.data.payments.find(item => item.payNo === e.currentTarget.dataset.payNo);
    if (!payment) return;
    this.setData({ busy: true });
    try {
      if (payment.metadata?.lfwin?.providerOrderNo || payment.metadata?.lfwin?.submissionState) {
        const result = await request("/api/payments/" + encodeURIComponent(payment.payNo) + "/lfwin/query", { method: "POST", data: {} });
        if (!this.sameOwner(owner)) return;
        if (result.payment?.status === "paid") this.key = null;
        wx.showToast({ title: result.payment?.status === "paid" ? "会员已开通" : "尚未确认付款", icon: "none" });
      } else wx.showToast({ title: "尚未发起付款，可继续支付", icon: "none" });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { if (this.sameOwner(owner)) await this.load(); this.setData({ busy: false }); }
  },
  async subscribe() {
    if (!this.canAct() || this.data.payments.length) return;
    const owner = this.ownerId;
    this.setData({ busy: true });
    try {
      this.key ||= "member:" + Date.now() + ":" + Math.random().toString(36).slice(2);
      const payment = await request("/api/member/payments", { method: "POST", data: { months: 1, idempotencyKey: this.key } });
      if (!this.sameOwner(owner)) return;
      await pay(payment);
      if (!this.sameOwner(owner)) return;
      this.key = null;
      wx.showToast({ title: "会员已开通" });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { if (this.sameOwner(owner)) await this.load(); this.setData({ busy: false }); }
  }
});
