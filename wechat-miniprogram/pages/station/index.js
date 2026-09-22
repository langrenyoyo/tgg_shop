const { request, clearStationSession } = require("../../utils/station-api");

Page({
  data: { station: {}, siteName: "授权站点", counts: {}, orders: [], view: "receive", loading: false, error: "" },
  onShow() { if (!wx.getStorageSync("tgg_station_token")) return wx.reLaunch({ url: "/pages/station-login/index" }); this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [me, dashboard, orders] = await Promise.all([request("/api/station/me"), request("/api/station/dashboard"), request("/api/station/orders")]);
      const site = me.sites?.[0] || {};
      const rows = (orders || []).filter(item => this.data.view === "receive" ? ["expected", "in_transit"].includes(item.stationStatus) : ["ready", "received"].includes(item.stationStatus)).map(item => ({ ...item, itemsText: (item.items || []).map(row => `${row.title || row.name || row.productId} × ${row.quantity}`).join("、") }));
      this.setData({ station: me.station || {}, siteName: site.name || "授权站点", counts: dashboard.counts || {}, orders: rows, loading: false });
    } catch (error) {
      if (error.statusCode === 401) { clearStationSession(); return wx.reLaunch({ url: "/pages/station-login/index" }); }
      this.setData({ error: error.message, loading: false });
    }
  },
  switchView(e) { this.setData({ view: e.currentTarget.dataset.view }, () => this.load()); },
  filteredOrders() { return this.data.orders.filter(row => this.data.view === "receive" ? ["expected", "in_transit"].includes(row.stationStatus) : ["ready", "received"].includes(row.stationStatus)); },
  async scan(e) {
    try {
      const result = await new Promise((resolve, reject) => wx.scanCode({ onlyFromCamera: false, scanType: ["qrCode", "barCode"], success: resolve, fail: reject }));
      const raw = String(result.result || "").trim();
      if (e.currentTarget.dataset.target === "orderId") return this.receiveById(raw);
      const payload = raw.startsWith("{") ? JSON.parse(raw) : { pickupCode: raw };
      return this.pickupByCode(payload.orderId || "", payload.pickupCode || payload.code || raw);
    } catch (error) { wx.showToast({ title: error.message || "扫码失败", icon: "none" }); }
  },
  manual() { wx.showModal({ title: this.data.view === "receive" ? "输入订单号" : "输入取货码", editable: true, success: result => { if (!result.confirm) return; this.data.view === "receive" ? this.receiveById(result.content.trim()) : this.pickupByCode("", result.content.trim()); } }); },
  receive(e) { this.receiveById(e.currentTarget.dataset.id); },
  pickup(e) { const row = this.data.orders.find(item => item.id === e.currentTarget.dataset.id); this.pickupByCode(row?.id || "", ""); },
  async receiveById(orderId) { if (!orderId) return wx.showToast({ title: "订单号不能为空", icon: "none" }); const row = this.data.orders.find(item => item.id === orderId); try { await request(`/api/station/orders/${encodeURIComponent(orderId)}/receive`, { method: "POST", data: { siteId: row?.pickupSiteId, condition: "normal", idempotencyKey: `mini_receive_${orderId}_${Date.now()}` } }); wx.showToast({ title: "收货成功" }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } },
  async pickupByCode(orderId, pickupCode) { if (!pickupCode) { return wx.showModal({ title: "输入取货码", editable: true, success: result => { if (result.confirm) this.pickupByCode(orderId, result.content.trim()); } }); } if (!orderId) { return wx.showModal({ title: "输入订单号", editable: true, success: result => { if (result.confirm) this.pickupByCode(result.content.trim(), pickupCode); } }); } const row = this.data.orders.find(item => item.id === orderId); try { await request(`/api/station/orders/${encodeURIComponent(orderId)}/pickup-verify`, { method: "POST", data: { siteId: row?.pickupSiteId, pickupCode, idempotencyKey: `mini_pickup_${orderId}_${Date.now()}` } }); wx.showToast({ title: "提货成功" }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } },
  async logout() { try { await request("/api/station/auth/logout", { method: "POST", retry: false }); } catch {} clearStationSession(); wx.reLaunch({ url: "/pages/station-login/index" }); }
});
