const { request, clearStationSession } = require("../../utils/station-api");

Page({
  data: { station: {}, siteName: "授权站点", counts: {}, orders: [], pickingConfig: {}, current: null, checkItems: [], shelfCode: "", busy: false, view: "receive", loading: false, error: "" },
  onShow() { if (!wx.getStorageSync("tgg_station_token")) return wx.reLaunch({ url: "/pages/station-login/index" }); this.load(); },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    this.setData({ loading: true, error: "" });
    try {
      const [me, dashboard, orders] = await Promise.all([request("/api/station/me"), request("/api/station/dashboard"), request("/api/station/orders")]);
      if (this.disposed || version !== this.version) return;
      const site = me.sites?.[0] || {};
      const rows = (orders || []).filter(item => item.status === "paid" && (this.data.view === "receive" ? ["expected", "in_transit", "picking"].includes(item.stationStatus) : this.data.view === "exceptions" ? item.stationStatus === "exception" || item.overdue : ["ready", "received"].includes(item.stationStatus))).map(item => ({ ...item, itemsText: (item.items || []).map(row => `${row.title || row.name || row.productId} × ${row.quantity}`).join("、") }));
      this.setData({ station: me.station || {}, siteName: site.name || "授权站点", pickingConfig: dashboard.pickingConfig || {}, counts: dashboard.counts || {}, orders: rows, loading: false });
      const summary = new Map();
      if (dashboard.pickingConfig?.batchEnabled && this.data.view === "receive") rows.forEach(order => (order.pickingItems || []).forEach(item => {
        const key = `${order.pickupSiteId}:${item.productId}`;
        const row = summary.get(key) || { ...item, key, siteName: me.sites?.find(site => site.id === order.pickupSiteId)?.name || order.pickupSiteId, quantity: 0 };
        row.quantity += item.quantity; summary.set(key, row);
      }));
      this.setData({ summary: [...summary.values()].sort((a,b) => a.pickSequence - b.pickSequence || a.locationCode.localeCompare(b.locationCode)) });
    } catch (error) {
      if (this.disposed || version !== this.version) return;
      if (error.statusCode === 401) { clearStationSession(); return wx.reLaunch({ url: "/pages/station-login/index" }); }
      this.setData({ error: error.message, loading: false });
    }
  },
  switchView(e) { if (!this.data.busy && !this.data.current) this.setData({ view: e.currentTarget.dataset.view }, () => this.load()); },
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
  async receiveById(orderId) {
    if (this.data.busy || this.data.current) return;
    if (!orderId) return wx.showToast({ title: "订单号不能为空", icon: "none" });
    this.setData({ busy: true });
    try {
      const result = await request(`/api/station/orders/${encodeURIComponent(orderId)}/picking`, { method: "POST", data: {} });
      const row = result.order;
      this.setData({ current: row, shelfCode: row.shelfCode || "", checkItems: row.pickingItems.map(item => ({ ...item, actualQuantity: "", scannedBarcode: "" })) });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ busy: false }); }
  },
  quantity(e) { if (!this.data.busy && !this.attempt) this.setData({ checkItems: this.data.checkItems.map((item, index) => index === Number(e.currentTarget.dataset.index) ? { ...item, actualQuantity: e.detail.value } : item) }); },
  shelf(e) { if (!this.data.busy && !this.attempt) this.setData({ shelfCode: e.detail.value }); },
  async scanProduct(e) {
    if (this.data.busy || this.attempt) return;
    const index = Number(e.currentTarget.dataset.index), row = this.data.checkItems[index];
    if (!row) return;
    this.setData({ busy: true });
    try {
      const result = await new Promise((resolve, reject) => wx.scanCode({ onlyFromCamera: true, scanType: ["barCode", "qrCode"], success: resolve, fail: reject }));
      if (!row.barcode || String(result.result).trim() !== row.barcode) throw new Error("商品条码不匹配，请检查商品或后台条码配置");
      this.setData({ checkItems: this.data.checkItems.map((item, i) => i === index ? { ...item, scannedBarcode: row.barcode } : item) });
    } catch (error) { wx.showToast({ title: error.message || "扫码取消", icon: "none" }); }
    finally { this.setData({ busy: false }); }
  },
  async confirmReceive() {
    if (this.data.busy || !this.data.current) return;
    this.setData({ busy: true });
    try {
      if (!this.attempt) {
        const items = this.data.checkItems;
        if (items.some(item => item.actualQuantity === "" || Number(item.actualQuantity) !== item.quantity)) throw new Error("请核对并填写每项实收数量；缺货请上报异常");
        if (this.data.pickingConfig.scanRequired && items.some(item => !item.scannedBarcode)) throw new Error("请扫码核对全部商品");
        this.attempt = { siteId: this.data.current.pickupSiteId, shelfCode: this.data.shelfCode, receivedItems: items.map(item => ({ productId: item.productId, quantity: Number(item.actualQuantity), barcode: item.scannedBarcode })), idempotencyKey: `mini_receive_${this.data.current.id}_${Date.now()}` };
      }
      await request(`/api/station/orders/${encodeURIComponent(this.data.current.id)}/receive`, { method: "POST", data: this.attempt });
      this.attempt = null;
      this.setData({ current: null, checkItems: [], pendingReceive: false });
      wx.showToast({ title: "收货上架成功" });
      await this.load();
    } catch (error) {
      if ([400, 404, 409].includes(error.statusCode)) this.attempt = null;
      this.setData({ pendingReceive: Boolean(this.attempt) });
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ busy: false }); }
  },
  async release() {
    if (this.data.busy || this.attempt || !this.data.current) return;
    this.setData({ busy: true });
    try { await request(`/api/station/orders/${encodeURIComponent(this.data.current.id)}/picking`, { method: "POST", data: { release: true } }); this.setData({ current: null }); await this.load(); }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ busy: false }); }
  },
  exception(e) {
    if (this.data.busy || this.attempt) return;
    const id = e.currentTarget.dataset.id || this.data.current?.id;
    wx.showModal({ title: "登记缺货、破损或超时说明", editable: true, success: async result => {
      if (!result.confirm || !result.content.trim() || this.data.busy) return;
      this.setData({ busy: true });
      try { await request(`/api/station/orders/${encodeURIComponent(id)}/exceptions`, { method: "POST", data: { type: "manual", remark: result.content.trim(), idempotencyKey: `mini_exception_${id}_${Date.now()}` } }); this.setData({ current: null }); await this.load(); }
      catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
      finally { this.setData({ busy: false }); }
    } });
  },
  retryPickup() { if (this.pickupAttempt) return this.pickupByCode(this.pickupAttempt.orderId, this.pickupAttempt.data.pickupCode); },
  async pickupByCode(orderId, pickupCode) {
    if (this.data.busy || this.data.current) return;
    if (this.pickupAttempt && (orderId !== this.pickupAttempt.orderId || pickupCode !== this.pickupAttempt.data.pickupCode)) return wx.showToast({ title: "请先重试确认上次提货", icon: "none" });
    if (!pickupCode) return wx.showModal({ title: "输入取货码", editable: true, success: result => { if (result.confirm) this.pickupByCode(orderId, result.content.trim()); } });
    if (!orderId) return wx.showModal({ title: "输入订单号", editable: true, success: result => { if (result.confirm) this.pickupByCode(result.content.trim(), pickupCode); } });
    this.setData({ busy: true });
    try {
      this.pickupAttempt ||= { orderId, data: { pickupCode, idempotencyKey: `mini_pickup_${orderId}_${Date.now()}` } };
      await request(`/api/station/orders/${encodeURIComponent(orderId)}/pickup-verify`, { method: "POST", data: this.pickupAttempt.data });
      this.pickupAttempt = null; this.setData({ pendingPickup: false });
      wx.showToast({ title: "提货成功" }); await this.load();
    } catch (error) {
      if ([400,404,409].includes(error.statusCode)) this.pickupAttempt = null;
      this.setData({ pendingPickup: Boolean(this.pickupAttempt) });
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ busy: false }); }
  },
  async logout() { if (this.data.busy || this.data.current || this.pickupAttempt) return wx.showToast({ title: "请先完成或释放当前任务", icon: "none" }); this.disposed = true; this.version = (this.version || 0) + 1; try { await request("/api/station/auth/logout", { method: "POST", retry: false }); } catch {} clearStationSession(); wx.reLaunch({ url: "/pages/station-login/index" }); }
});
