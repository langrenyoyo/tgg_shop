const { request } = require("../../utils/api");
const { pay } = require("../../utils/payment");
const ORDER_LABELS = { pending_payment: "待付款", paid: "已付款", completed: "已完成", cancelled: "已取消", closed: "已关闭", refunding: "退款处理中", refunded: "已退款" };
const FULFILLMENT_LABELS = { not_started: "尚未安排", pending_pickup: "待自提", picked_up: "已自提", pending_ship: "待配送", shipping: "配送中", delivered: "已送达", cancelled: "已取消" };
const REFUND_LABELS = { pending_review: "等待退款审核", processing: "退款处理中", refunded: "退款已完成", rejected: "退款未通过", failed: "退款失败，待处理" };
function nextStep(order) {
  if (order.status === "pending_payment") return "请完成付款；如已付款，请查询结果后再决定是否继续支付。";
  if (order.status === "refunding") return "退款申请已提交，请在下方查看审核和退款进度。";
  if (order.status === "refunded") return "退款账务已完成。如涉及退货，商品验收由工作人员另行核对。";
  if (order.status === "cancelled" || order.status === "closed") return "订单已结束，可返回商城选购。";
  if (order.status === "completed") return "订单已完成。如有售后问题，可填写原因申请退款。";
  if (order.status === "paid" && order.fulfillmentStatus === "pending_pickup") return "请前往下方自提点，向工作人员出示自提码。";
  if (order.status === "paid" && order.fulfillmentStatus === "pending_ship") return "付款已确认，等待商家安排配送。";
  if (order.status === "paid" && order.fulfillmentStatus === "shipping") return "商品正在配送，请实际收到商品后再确认收货。";
  return "请刷新查看最新订单进度。";
}
Page({
  data: { order: null, reason: "", error: "", busy: false, loading: false },
  onLoad(query) { this.id = query.id; },
  onShow() { this.load(); },
  onUnload() { this.version = (this.version || 0) + 1; this.ownerId = null; },
  sameOwner(owner = this.ownerId) { return Boolean(owner && owner === this.ownerId && owner === wx.getStorageSync("tgg_user")?.id && wx.getStorageSync("tgg_token")); },
  canAct() {
    if (!this.sameOwner()) { this.load(); return false; }
    return !this.data.busy && !this.data.loading && Boolean(this.data.order) && !this.data.error;
  },
  goLogin() { wx.navigateTo({ url: "/pages/login/index" }); },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (this.ownerId !== owner) this.setData({ reason: "" });
    this.ownerId = owner;
    this.setData({ order: null, error: "", loading: false });
    if (!this.sameOwner(owner)) { this.setData({ error: "请登录后查看订单" }); return; }
    if (!this.id) { this.setData({ error: "缺少订单编号，请从订单列表重新进入" }); return; }
    this.setData({ loading: true });
    try {
      const order = await request("/api/orders/" + encodeURIComponent(this.id));
      if (!order) throw new Error("订单不存在");
      const refunds = await Promise.all((order.refunds || []).map(refund => request("/api/refunds/" + encodeURIComponent(refund.id)).catch(() => refund)));
      if (version !== this.version || !this.sameOwner(owner)) return;
      this.setData({ order: { ...order, statusText: ORDER_LABELS[order.status] || "订单状态待核对", fulfillmentText: ["cancelled", "closed", "refunded"].includes(order.status) ? "" : FULFILLMENT_LABELS[order.fulfillmentStatus] || "", nextStep: nextStep(order), refunds: refunds.map(refund => ({ ...refund, statusText: REFUND_LABELS[refund.status] || "退款状态待核对" })) }, error: "" });
    } catch (error) { if (version === this.version && this.sameOwner(owner)) this.setData({ error: error.message }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  reason(e) { this.setData({ reason: e.detail.value }); },
  async queryPayment() {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    this.setData({ busy: true });
    try {
      const payments = await request("/api/payments");
      if (!this.sameOwner(owner)) return;
      const payment = payments.find(item => item.orderId === this.id && item.direction === "in" && item.status === "pending");
      if (payment && (payment.metadata?.lfwin?.providerOrderNo || payment.metadata?.lfwin?.submissionState)) {
        const result = await request("/api/payments/" + encodeURIComponent(payment.payNo) + "/lfwin/query", { method: "POST", data: {} });
        wx.showToast({ title: result.payment?.status === "paid" ? "付款已确认" : "尚未确认付款", icon: "none" });
      } else wx.showToast({ title: "请刷新查看订单状态", icon: "none" });
      await this.load();
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ busy: false }); }
  },
  async pay() {
    if (!this.canAct()) return;
    const owner = this.ownerId;
    this.setData({ busy: true });
    try {
      const payment = await request("/api/orders/" + encodeURIComponent(this.id) + "/payments", { method: "POST", data: { channel: "lfwin_wechat_mini" } });
      if (!this.sameOwner(owner)) return;
      await pay(payment);
      await this.load();
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ busy: false }); }
  },
  async action(e) {
    if (!this.canAct()) return;
    const action = e.currentTarget.dataset.action;
    if (!["cancel", "receive"].includes(action)) return;
    const owner = this.ownerId;
    this.setData({ busy: true });
    try {
      const confirmed = await new Promise(resolve => wx.showModal({ title: action === "cancel" ? "确认取消订单？" : "确认已收到商品？", success: result => resolve(result.confirm), fail: () => resolve(false) }));
      if (!confirmed || !this.sameOwner(owner)) return;
      await request("/api/orders/" + encodeURIComponent(this.id) + "/" + action, { method: "POST", data: {} }); await this.load();
    }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ busy: false }); }
  },
  async refund() {
    if (!this.canAct()) return;
    if (!this.data.reason.trim()) return wx.showToast({ title: "请填写退款原因", icon: "none" });
    this.setData({ busy: true });
    try {
      await request("/api/orders/" + encodeURIComponent(this.id) + "/refunds", { method: "POST", data: { reason: this.data.reason.trim() } });
      wx.showToast({ title: "已申请退款" }); await this.load();
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ busy: false }); }
  }
});
