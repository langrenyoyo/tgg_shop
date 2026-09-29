const { request, clearStationSession } = require("../../utils/station-api");

Page({
  data: { station: {}, canReceive: false, canPickup: false, canException: false, siteName: "授权站点", counts: {}, orders: [], pickingConfig: {}, current: null, checkItems: [], shelfCode: "", packageRows: [], storageLabels: ["常温", "冷藏", "冷冻", "生鲜"], pickupPreview: null, pickupChecked: [], pickupReady: false, busy: false, view: "receive", loading: false, error: "" },
  onShow() { if (!wx.getStorageSync("tgg_station_token")) return wx.reLaunch({ url: "/pages/station-login/index" }); this.load(); },
  onUnload() { this.disposed = true; this.version = (this.version || 0) + 1; },
  handleActionError(error) {
    if (error.statusCode === 401) {
      this.attempt = this.pickupAttempt = null;
      this.disposed = true; this.version = (this.version || 0) + 1;
      this.setData({ current: null, pickupPreview: null, orders: [], pendingReceive: false, pendingPickup: false, canReceive: false, canPickup: false, canException: false });
      clearStationSession();
      wx.reLaunch({ url: "/pages/station-login/index" });
      return;
    }
    wx.showToast({ title: error.message || "操作失败", icon: "none" });
  },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    this.setData({ loading: true, error: "" });
    try {
      const [me, dashboard, orders] = await Promise.all([request("/api/station/me"), request("/api/station/dashboard"), request("/api/station/orders")]);
      if (this.disposed || version !== this.version) return;
      const site = me.sites?.[0] || {};
      const permissions = me.station?.permissions || [];
      this.setData({ canReceive: permissions.includes("station:receive"), canPickup: permissions.includes("station:pickup"), canException: permissions.includes("station:exception") });
      if (!this.permissionsLoaded) {
        this.permissionsLoaded = true;
        this.setData({ view: this.data.canReceive ? "receive" : this.data.canPickup ? "pickup" : "exceptions" });
      }
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
  switchView(e) { if (!this.data.busy && !this.data.current && !this.data.pickupPreview) this.setData({ view: e.currentTarget.dataset.view }, () => this.load()); },
  filteredOrders() { return this.data.orders.filter(row => this.data.view === "receive" ? ["expected", "in_transit"].includes(row.stationStatus) : ["ready", "received"].includes(row.stationStatus)); },
  async scan(e) {
    if (this.data.busy || this.data.current || this.data.pickupPreview) return;
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
    if (!this.data.canReceive) return wx.showToast({ title: "没有收货权限", icon: "none" });
    if (this.data.busy || this.data.current || this.data.pickupPreview) return;
    if (!orderId) return wx.showToast({ title: "订单号不能为空", icon: "none" });
    this.setData({ busy: true });
    try {
      const result = await request(`/api/station/orders/${encodeURIComponent(orderId)}/picking`, { method: "POST", data: {} });
      const row = result.order;
      const packageRows = row.packages?.length ? row.packages : [...new Set(row.pickingItems.map(item => item.storageType || "ambient"))].map(storageType => ({ storageType, shelfCode: "", bagCount: 1 }));
      this.setData({ current: row, shelfCode: row.shelfCode || "", packageRows: packageRows.map(item => ({ ...item, typeIndex: Math.max(0, ["ambient", "chilled", "frozen", "fresh"].indexOf(item.storageType)) })), checkItems: row.pickingItems.map(item => ({ ...item, actualQuantity: "", scannedBarcode: "" })) });
    } catch (error) { this.handleActionError(error); }
    finally { this.setData({ busy: false }); }
  },
  quantity(e) { if (!this.data.busy && !this.attempt) this.setData({ checkItems: this.data.checkItems.map((item, index) => index === Number(e.currentTarget.dataset.index) ? { ...item, actualQuantity: e.detail.value } : item) }); },
  shelf(e) { if (!this.data.busy && !this.attempt) this.setData({ shelfCode: e.detail.value }); },
  packageField(e) {
    if (this.data.busy || this.attempt) return;
    const { index, field } = e.currentTarget.dataset;
    if (!["shelfCode", "bagCount", "typeIndex"].includes(field)) return;
    this.setData({ packageRows: this.data.packageRows.map((item, i) => i === Number(index) ? { ...item, [field]: e.detail.value, ...(field === "typeIndex" ? { storageType: ["ambient", "chilled", "frozen", "fresh"][Number(e.detail.value)] } : {}) } : item) });
  },
  addPackage() { if (!this.data.busy && !this.attempt && this.data.packageRows.length < 12) this.setData({ packageRows: [...this.data.packageRows, { storageType: "ambient", typeIndex: 0, shelfCode: "", bagCount: 1 }] }); },
  removePackage(e) { if (!this.data.busy && !this.attempt && this.data.packageRows.length > 1) this.setData({ packageRows: this.data.packageRows.filter((_, i) => i !== Number(e.currentTarget.dataset.index)) }); },
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
    if (!this.data.canReceive) return wx.showToast({ title: "没有收货权限", icon: "none" });
    if (this.data.busy || !this.data.current) return;
    this.setData({ busy: true });
    try {
      if (!this.attempt) {
        const items = this.data.checkItems;
        if (items.some(item => item.actualQuantity === "" || Number(item.actualQuantity) !== item.quantity)) throw new Error("请核对并填写每项实收数量；缺货请上报异常");
        if (this.data.pickingConfig.scanRequired && items.some(item => !item.scannedBarcode)) throw new Error("请扫码核对全部商品");
        const packages = this.data.packageRows.map(item => ({ shelfCode: item.shelfCode.trim(), storageType: item.storageType, bagCount: Number(item.bagCount) }));
        if (!packages.length || packages.some(item => !Number.isInteger(item.bagCount) || item.bagCount < 1 || item.bagCount > 99 || (item.storageType !== "ambient" && !item.shelfCode))) throw new Error("请填写各位置袋数，冷藏、冷冻和生鲜区须填写实际位置");
        this.attempt = { siteId: this.data.current.pickupSiteId, packages, receivedItems: items.map(item => ({ productId: item.productId, quantity: Number(item.actualQuantity), barcode: item.scannedBarcode })), idempotencyKey: `mini_receive_${this.data.current.id}_${Date.now()}` };
      }
      await request(`/api/station/orders/${encodeURIComponent(this.data.current.id)}/receive`, { method: "POST", data: this.attempt });
      this.attempt = null;
      this.setData({ current: null, checkItems: [], pendingReceive: false });
      wx.showToast({ title: "收货上架成功" });
      await this.load();
    } catch (error) {
      if (error.statusCode === 401) return this.handleActionError(error);
      if ([400, 403, 404, 409].includes(error.statusCode)) this.attempt = null;
      this.setData({ pendingReceive: Boolean(this.attempt) });
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ busy: false }); }
  },
  async release() {
    if (this.data.busy || this.attempt || !this.data.current) return;
    this.setData({ busy: true });
    try { await request(`/api/station/orders/${encodeURIComponent(this.data.current.id)}/picking`, { method: "POST", data: { release: true } }); this.setData({ current: null }); await this.load(); }
    catch (error) { this.handleActionError(error); }
    finally { this.setData({ busy: false }); }
  },
  exception(e) {
    if (!this.data.canException) return wx.showToast({ title: "没有异常登记权限", icon: "none" });
    if (this.data.busy || this.attempt || this.pickupAttempt) return;
    const id = e.currentTarget.dataset.id || this.data.current?.id;
    wx.showModal({ title: "登记缺货、破损或超时说明", editable: true, success: async result => {
      if (!result.confirm || !result.content.trim() || this.data.busy) return;
      this.setData({ busy: true });
      try { await request(`/api/station/orders/${encodeURIComponent(id)}/exceptions`, { method: "POST", data: { type: "manual", remark: result.content.trim(), idempotencyKey: `mini_exception_${id}_${Date.now()}` } }); this.setData({ current: null }); await this.load(); }
      catch (error) { this.handleActionError(error); }
      finally { this.setData({ busy: false }); }
    } });
  },
  retryPickup() { if (this.pickupAttempt) return this.confirmPickup(); },
  pickupCheck(e) {
    if (this.data.busy || this.pickupAttempt) return;
    const ids = e.detail.value || [], packages = this.data.pickupPreview?.order?.packages || [];
    this.setData({ pickupChecked: ids, pickupReady: packages.length > 0 && packages.every(item => ids.includes(item.id)) });
  },
  cancelPickup() {
    if (this.data.busy || this.pickupAttempt) return;
    this.lookupCode = "";
    this.setData({ pickupPreview: null, pickupChecked: [], pickupReady: false });
  },
  async pickupByCode(orderId, pickupCode) {
    if (!this.data.canPickup) return wx.showToast({ title: "没有提货核验权限", icon: "none" });
    if (this.data.busy || this.data.current || this.data.pickupPreview) return;
    if (!pickupCode) return wx.showModal({ title: "输入取货码", editable: true, success: result => { if (result.confirm) this.pickupByCode(orderId, result.content.trim()); } });
    this.setData({ busy: true });
    try {
      const result = await request("/api/station/pickup-lookup", { method: "POST", data: { orderId, pickupCode: pickupCode.trim() } });
      if (this.disposed) return;
      this.lookupCode = pickupCode.trim();
      this.setData({ pickupPreview: result, pickupChecked: [], pickupReady: false });
    } catch (error) {
      if (error.statusCode === 409 && !orderId) {
        wx.showModal({ title: "提货码重复，请输入完整订单号", editable: true, success: result => { if (result.confirm && result.content.trim()) this.pickupByCode(result.content.trim(), pickupCode); } });
      } else this.handleActionError(error);
    } finally { this.setData({ busy: false }); }
  },
  async confirmPickup() {
    if (!this.data.canPickup || this.data.busy || !this.data.pickupPreview) return;
    if (!this.pickupAttempt && !this.data.pickupReady) return wx.showToast({ title: "请逐项核对位置和袋数", icon: "none" });
    this.setData({ busy: true });
    try {
      const preview = this.data.pickupPreview;
      this.pickupAttempt ||= { orderId: preview.order.id, data: { pickupCode: this.lookupCode, pickupVersion: preview.pickupVersion, confirmedPackageIds: [...this.data.pickupChecked], idempotencyKey: `mini_pickup_${preview.order.id}_${Date.now()}` } };
      const orderId = this.pickupAttempt.orderId;
      await request(`/api/station/orders/${encodeURIComponent(orderId)}/pickup-verify`, { method: "POST", data: this.pickupAttempt.data });
      this.pickupAttempt = null; this.lookupCode = ""; this.setData({ pendingPickup: false, pickupPreview: null, pickupReady: false, pickupChecked: [] });
      wx.showToast({ title: "提货成功" }); await this.load();
    } catch (error) {
      if (error.statusCode === 401) return this.handleActionError(error);
      if ([400,403,404,409].includes(error.statusCode)) this.pickupAttempt = null;
      if ([400,403,404,409].includes(error.statusCode)) this.setData({ pickupPreview: null, pickupReady: false, pickupChecked: [] });
      this.setData({ pendingPickup: Boolean(this.pickupAttempt) });
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ busy: false }); }
  },
  async logout() { if (this.data.busy || this.data.current || this.pickupAttempt) return wx.showToast({ title: "请先完成或释放当前任务", icon: "none" }); this.disposed = true; this.version = (this.version || 0) + 1; try { await request("/api/station/auth/logout", { method: "POST", retry: false }); } catch {} clearStationSession(); wx.reLaunch({ url: "/pages/station-login/index" }); }
});
