const { request } = require("../../utils/api");

Page({
  data: {
    orders: [], loading: false, error: "", page: 0, hasMore: false, filterIndex: 0,
    filters: [
      { label: "全部订单", query: "" }, { label: "待付款", query: "&status=pending_payment" },
      { label: "待自提", query: "&status=paid&fulfillmentStatus=pending_pickup" },
      { label: "待配送", query: "&status=paid&fulfillmentStatus=pending_ship" },
      { label: "配送中", query: "&status=paid&fulfillmentStatus=shipping" },
      { label: "已完成", query: "&status=completed" }, { label: "退款中", query: "&status=refunding" },
      { label: "已退款", query: "&status=refunded" }, { label: "已取消", query: "&status=cancelled" }
    ]
  },

  onShow() {
    this.load();
  },
  open(e) { if (!this.ownerId || this.ownerId !== wx.getStorageSync("tgg_user")?.id) return; wx.navigateTo({ url: "/pages/order-detail/index?id=" + encodeURIComponent(e.currentTarget.dataset.id) }); },
  filter(e) { this.setData({ filterIndex: Number(e.detail.value), orders: [], page: 0 }, () => this.load()); },
  onUnload() { this.version = (this.version || 0) + 1; },
  onReachBottom() { this.loadMore(); },
  loadMore() { if (!this.data.loading && this.data.hasMore) this.load(true); },

  async load(append = false) {
    append = append === true;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (owner !== this.ownerId) append = false;
    this.ownerId = owner;
    const version = this.version = (this.version || 0) + 1;
    const active = () => version === this.version && owner === wx.getStorageSync("tgg_user")?.id;
    const page = append ? this.data.page + 1 : 1;
    this.setData({ loading: true, error: "", ...(!append ? { orders: [], page: 0, hasMore: false } : {}) });
    if (!owner) { this.setData({ loading: false, error: "请先登录后查看订单" }); return; }
    try {
      const rows = await request("/api/orders?page=" + page + "&count=20" + this.data.filters[this.data.filterIndex].query);
      if (!active()) return;
      const labels = { pending_payment: "待付款", paid: "已付款", completed: "已完成", cancelled: "已取消", closed: "已关闭", refunding: "退款中", refunded: "已退款" };
      const fulfillment = { pending_pickup: "待自提", picked_up: "已自提", pending_ship: "待配送", shipping: "配送中", delivered: "已送达" };
      const orders = rows.map(order => ({ ...order, statusText: labels[order.status] || order.status, fulfillmentText: ["paid", "completed"].includes(order.status) ? fulfillment[order.fulfillmentStatus] || "" : "" }));
      this.setData({ orders: append ? this.data.orders.concat(orders) : orders, page, hasMore: rows.length === 20 });
    } catch (error) {
      if (active()) this.setData({ error: error.message });
    } finally { if (active()) this.setData({ loading: false }); }
  }
});
