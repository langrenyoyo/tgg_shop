const { request: apiRequest } = require("../../utils/api");
const request = (path, options = {}) => apiRequest(path, { ...options, authRequired: true });
const { showSigninAd } = require("../../utils/signin-ad");
const makeKey = () => "signin:" + Date.now() + ":" + Math.random().toString(36).slice(2);
Page({
  data: { loading: true, busy: false, error: "", needLogin: false, unavailableReason: "", session: null, config: {}, balanceCoins: 0, sheet: "", countdown: 0, dots: [], pendingStep: false, adLabel: "", bannerFailed: false, feedFailed: false },
  onShow() { this.hidden = false; this.owner = wx.getStorageSync("tgg_user")?.id; clearInterval(this.timer); this.load(); this.timer = setInterval(() => this.tick(), 1000); },
  onHide() {
    this.hidden = true; this.version = (this.version || 0) + 1; clearInterval(this.timer); this.adTask?.cancel();
    this.roundKey = null; wx.removeStorageSync(this.storageKey());
    this.setData({ busy: false, pendingStep: false });
  },
  onUnload() { this.disposed = true; this.onHide(); },
  valid(version, owner) { return !this.disposed && !this.hidden && version === this.version && owner === this.owner && owner === wx.getStorageSync("tgg_user")?.id && Boolean(wx.getStorageSync("tgg_token")); },
  currentView(version, owner) { return !this.disposed && !this.hidden && version === this.version && owner === this.owner; },
  handleLoginRequired(error, version, owner) {
    const currentOwner = wx.getStorageSync("tgg_user")?.id;
    if (error.statusCode !== 401 || !this.currentView(version, owner) || (currentOwner && currentOwner !== owner)) return false;
    this.adTask?.cancel(); this.adTask = null; this.roundKey = null;
    wx.removeStorageSync(this.storageKey());
    wx.disableAlertBeforeUnload?.();
    this.setData({ loading: false, busy: false, needLogin: true, error: "登录已失效，请重新登录后继续签到", session: null, config: {}, balanceCoins: 0,
      sheet: "", pendingStep: false, adLabel: "", dots: [], countdown: 0, unavailableReason: "" });
    return true;
  },
  storageKey() { return "tgg_coin_signin_step:" + this.owner; },
  apply(status) {
    this.offset = status.serverNow - Date.now();
    const pending = wx.getStorageSync(this.storageKey());
    const session = status.session;
    const pendingStep = Boolean(pending && pending.sessionId === session?.id && !session.claimed && session.completedRounds < session.rounds);
    if (pending && !pendingStep) wx.removeStorageSync(this.storageKey());
    this.setData({ session, config: status.config, balanceCoins: status.balanceCoins, unavailableReason: status.unavailableReason, pendingStep,
      dots: Array.from({ length: session?.rounds || 0 }, (_, i) => ({ number: i + 1, done: i < session.completedRounds })) });
    this.tick();
    if (session && !session.claimed) wx.enableAlertBeforeUnload?.({ message: "已完成轮数将保留，本轮需重新完成" });
    else wx.disableAlertBeforeUnload?.();
  },
  tick() { this.setData({ countdown: Math.max(0, Math.ceil(((this.data.session?.nextAt || 0) - Date.now() - (this.offset || 0)) / 1000)) }); },
  async load() {
    const version = this.version = (this.version || 0) + 1, owner = this.owner;
    this.setData({ loading: true, busy: false, error: "", session: null, sheet: "", pendingStep: false, balanceCoins: 0, config: {}, needLogin: false });
    if (!owner || !wx.getStorageSync("tgg_token")) { this.setData({ loading: false, needLogin: true, error: "请登录后签到" }); return; }
    try { const status = await request("/api/coin-signin/status"); if (this.valid(version, owner)) this.apply(status); }
    catch (error) { if (!this.handleLoginRequired(error, version, owner) && this.valid(version, owner)) this.setData({ error: error.message }); }
    finally { if (!this.disposed && version === this.version) this.setData({ loading: false }); }
  },
  login() { wx.navigateTo({ url: "/pages/login/index" }); },
  async openSignin() {
    if (this.data.loading || this.data.busy || this.data.error || this.data.session?.claimed) return;
    if (!this.data.session && this.data.unavailableReason) return;
    await this.perform(async () => {
      const result = await request("/api/coin-signin/start", { method: "POST", data: {} });
      return { result, sheet: "progress" };
    });
  },
  async perform(operation) {
    if (this.data.busy || !this.valid(this.version, this.owner)) return;
    const version = this.version, owner = this.owner;
    const alive = () => this.valid(version, owner);
    this.setData({ busy: true, error: "" });
    try { const value = await operation(alive); if (alive() && value) { this.apply(value.result); this.setData({ sheet: value.result.session?.claimed ? "success" : value.sheet || "progress" }); } }
    catch (error) { if (!this.handleLoginRequired(error, version, owner) && alive()) this.setData({ error: error.message, sheet: this.data.pendingStep ? "verify" : "progress" }); }
    finally { if (alive()) this.setData({ busy: false, adLabel: "" }); }
  },
  async getRound() {
    if (!this.data.session || this.data.busy || this.data.countdown || this.data.pendingStep || this.data.unavailableReason) return;
    await this.perform(async alive => {
      const sessionId = this.data.session.id;
      this.roundKey ||= makeKey();
      let result = await request("/api/coin-signin/round", { method: "POST", data: { sessionId, idempotencyKey: this.roundKey } });
      if (!alive()) return;
      this.roundKey = null;
      return this.playAttempt(result, alive);
    });
  },
  async playAttempt(result, alive) {
    while (!result.attempt.completed) {
      if (!alive()) return;
      const step = result.attempt.steps[result.attempt.nextStep];
      this.setData({ adLabel: `本轮第 ${result.attempt.nextStep + 1}/${result.attempt.steps.length} 步 · ${step.type === "rewarded" ? "激励视频" : "插屏广告"}` });
      this.adTask = showSigninAd(step);
      await this.adTask.promise;
      this.adTask = null;
      if (!alive()) return;
      const pending = { sessionId: result.session.id, attemptId: result.attempt.id, stepId: step.id };
      wx.setStorageSync(this.storageKey(), pending);
      this.setData({ pendingStep: true });
      result = await request("/api/coin-signin/step", { method: "POST", data: pending });
      if (!alive()) return;
      wx.removeStorageSync(this.storageKey()); this.setData({ pendingStep: false });
    }
    return { result, sheet: "progress" };
  },
  async retryVerification() {
    await this.perform(async alive => {
      const pending = wx.getStorageSync(this.storageKey());
      if (!pending || pending.sessionId !== this.data.session?.id) throw new Error("签到状态已变化，请刷新");
      const result = await request("/api/coin-signin/step", { method: "POST", data: pending });
      if (!alive()) return;
      wx.removeStorageSync(this.storageKey()); this.setData({ pendingStep: false });
      return this.playAttempt(result, alive);
    });
  },
  async claim() {
    if (!this.data.session || this.data.session.completedRounds !== this.data.session.rounds || this.data.session.claimed) return;
    await this.perform(async () => {
      this.setData({ sheet: "claiming" });
      try { return { result: await request("/api/coin-signin/claim", { method: "POST", data: { sessionId: this.data.session.id } }) }; }
      catch (error) { if (error.statusCode === 401) throw error; throw new Error("奖励结果待确认，请刷新查询；未到账时可再次点击完成签到，不会重复发放"); }
    });
  },
  exit() {
    if (this.data.session && !this.data.session.claimed) this.setData({ previousSheet: this.data.sheet, sheet: "exit" });
    else this.setData({ sheet: "" });
  },
  cancelExit() { this.setData({ sheet: this.data.previousSheet || "progress" }); },
  confirmExit() {
    this.version = (this.version || 0) + 1; this.adTask?.cancel(); this.roundKey = null;
    wx.removeStorageSync(this.storageKey()); this.setData({ sheet: "", busy: false, pendingStep: false, error: "", adLabel: "" });
  },
  closeSuccess() { this.setData({ sheet: "" }); },
  adError(e) { this.setData(e.currentTarget.dataset.kind === "feed" ? { feedFailed: true } : { bannerFailed: true }); },
  noop() {}
});
