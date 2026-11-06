const { request } = require("../../utils/api");
const TITLES = { payments: "支付记录", ranking: "积分排行榜", pointExchange: "积分换余额", withdraw: "提现", customerService: "在线客服", feedback: "意见反馈", business: "商务合作", recruiting: "代理申请", pickupSite: "自提点" };
const WITHDRAWAL_STATUSES = { pending_review: "审核中", approved: "审核通过，待提交", processing: "处理中", success: "已到账", failed: "提现失败", rejected: "已驳回", cancelled: "已撤销" };
function withdrawalDayKey(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
Page({
  data: { type: "payments", title: "支付记录", rows: [], balance: 0, points: 0, config: {}, exchangeAmount: "", exchangePreview: "0.00", exchangePointsError: "", exchangeEnabled: false, withdrawRules: {}, withdrawNoticeLines: [], withdrawLimitReached: false, balanceBelowMinimum: false, withdrawAmountError: "", authorizationStatus: "none", authorizationExpiresAt: "", loading: true, error: "", needLogin: false, submitting: false },
  onLoad(query) { this.type = query.type || "payments"; this.setData({ type: this.type, title: TITLES[this.type] || "用户服务" }); this.load(); },
  onHide() {
    this.wasHidden = true;
    if (this.type === "withdraw") {
      this.loadVersion = (this.loadVersion || 0) + 1;
      this.setData({ authorizationStatus: "unknown", submitting: false });
    }
  },
  onShow() {
    if (this.type === "withdraw" && this.wasHidden) {
      this.wasHidden = false;
      return this.load();
    }
  },
  onUnload() { this.disposed = true; this.loadVersion = (this.loadVersion || 0) + 1; },
  currentOwner() { return wx.getStorageSync?.("tgg_user")?.id || ""; },
  async load() {
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    const owner = this.currentOwner();
    const current = () => !this.disposed && version === this.loadVersion && owner === this.currentOwner();
    this.setData({ loading: true, error: "", needLogin: false, ...(this.type === "withdraw" ? { authorizationStatus: "unknown", authorizationExpiresAt: "", balance: 0, rows: [] } : {}) });
    try {
      if (this.type === "payments") this.setData({ rows: await request("/api/payments") });
      else if (this.type === "ranking") this.setData({ rows: (await request("/api/ranking")).rows || [] });
      else if (this.type === "pointExchange") {
        const [user, config] = await Promise.all([request("/api/me"), request("/api/config")]);
        const rate = Number(config.pointBalanceExchangeRate || 0.1);
        const minimum = Number(config.pointBalanceExchangeMinPoints || 100);
        this.exchangeContext = { rate, minimum, points: Number(user.points || 0) };
        this.setData({ points: Number(user.points || 0), config, exchangeEnabled: config.pointBalanceExchangeEnabled === true,
          exchangeAmount: "", exchangePreview: "0.00", exchangePointsError: this.exchangeError(this.data.exchangeAmount) });
      } else if (this.type === "withdraw") {
        const [user, config, rows, authorization] = await Promise.all([request("/api/me"), request("/api/config"), request("/api/withdrawals"),
          request("/api/withdrawals/authorization").catch(loadError => ({ status: "unknown", required: true, loadError }))]);
        if (!current()) return;
        if (owner && user.id !== owner) throw new Error("账号信息已变化，请重新登录");
        const dailyCountLimit = Number(config.withdrawDailyCountLimit || 0);
        const dailyAmountLimit = Number(config.withdrawDailyAmountLimit || 0);
        const minAmount = Number(config.withdrawMinAmount || 1);
        const maxAmount = Number(config.withdrawMaxAmount || 500);
        const timeZone = config.deliveryTimeZone || "Asia/Shanghai";
        const safeRows = (Array.isArray(rows) ? rows : []).map(item => ({ ...item, statusText: WITHDRAWAL_STATUSES[item.status] || "状态待核对" }));
        const today = withdrawalDayKey(Date.now(), timeZone);
        const countedToday = safeRows.filter(item => withdrawalDayKey(item.createdAt || item.updatedAt || 0, timeZone) === today && !["failed", "rejected", "cancelled"].includes(item.status));
        const usedToday = countedToday.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const balance = Number(user.withdrawableBalance || 0);
        const countLimitReached = dailyCountLimit > 0 && countedToday.length >= dailyCountLimit;
        const amountLimitReached = dailyAmountLimit > 0 && dailyAmountLimit - usedToday < minAmount - 0.005;
        this.withdrawContext = { minAmount, maxAmount, balance, dailyAmountLimit, usedToday };
        this.setData({
          balance,
          config,
          withdrawRules: {
            minAmount,
            maxAmount,
            feePercent: Number(config.withdrawFeeRate ?? 0) * 100,
            dailyCount: dailyCountLimit > 0 ? `${dailyCountLimit} 次/日` : "不限",
            dailyAmount: dailyAmountLimit > 0 ? `¥${dailyAmountLimit}/日` : "不限",
            todayCount: countedToday.length,
            todayAmount: usedToday.toFixed(2),
            notice: String(config.withdrawNotice || "").trim()
          },
          withdrawNoticeLines: String(config.withdrawNotice || "").trim().split(/\r?\n/).filter(Boolean),
          withdrawLimitReached: countLimitReached || amountLimitReached,
          balanceBelowMinimum: balance < minAmount,
          authorizationStatus: authorization.status || "none",
          authorizationRequired: authorization.required !== false,
          authorizationExpiresAt: authorization.expiresAt || "",
          authorizationMethod: authorization.method || "native",
          error: authorization.loadError?.message || "",
          needLogin: authorization.loadError?.statusCode === 401,
          withdrawAmountError: this.amountError(this.data.amount),
          rows: safeRows
        });
      }
      else if (this.type === "pickupSite") this.setData({ rows: await request("/api/pickup-sites") });
      else this.setData({ rows: (await request("/api/tickets")).filter(item => item.type === this.type || (this.type === "customerService" && item.type === "customer_service")) });
    } catch (error) {
      if (!this.disposed && version === this.loadVersion) this.setData({ error: error.message || "加载失败，请重试", needLogin: error.statusCode === 401 });
    } finally { if (!this.disposed && version === this.loadVersion) this.setData({ loading: false }); }
  },
  login() { wx.navigateTo({ url: "/pages/login/index" }); },
  async authorizeWechat() {
    if (this.disposed || this.data.submitting || this.data.loading || this.data.error || this.data.authorizationStatus === "active") return;
    const owner = this.currentOwner();
    if (!owner) return this.login();
    if (this.authorizing) return;
    const version = this.loadVersion;
    let jumped = false;
    this.authorizing = true;
    this.setData({ submitting: true });
    try {
      const result = await request("/api/withdrawals/authorization", { method: "POST", data: {} });
      if (this.disposed || owner !== this.currentOwner() || version !== this.loadVersion) return;
      if (result.status === "active") return;
      if (result.method === "miniProgram") {
        if (!/^wx[a-zA-Z0-9]{16}$/.test(result.appId || "") || !result.path || /^[a-z]+:\/\//i.test(result.path)) throw new Error("授权页面信息不完整，请刷新后重试");
        if (typeof wx.navigateToMiniProgram !== "function") throw new Error("当前微信版本不支持，请升级微信后重试");
        await new Promise((resolve, reject) => wx.navigateToMiniProgram({
          appId: result.appId, path: result.path, envVersion: "release", success: resolve, fail: reject
        }));
        // Navigation success and referrerInfo.extraData.is_auth are not proof of consent.
        // onShow reloads 4.13 from the server after the user returns.
        jumped = true;
        return;
      }
      if (typeof wx.requestMerchantTransfer !== "function" || (wx.canIUse && !wx.canIUse("requestMerchantTransfer"))) throw new Error("当前微信版本不支持，请升级微信后重试");
      const appId = wx.getAccountInfoSync?.().miniProgram?.appId;
      if (!appId || result.appId !== appId || !result.mchId || !result.authorizationPackage) throw new Error("授权信息不完整或与当前小程序不匹配");
      // Native success is only a UI result. The server queries Huifu for effective consent.
      await new Promise((resolve, reject) => wx.requestMerchantTransfer({
        appId,
        mchId: result.mchId,
        package: result.authorizationPackage,
        success: resolve,
        fail: reject
      }));
    } catch (error) {
      if (!this.disposed && owner === this.currentOwner()) wx.showToast({
        title: /cancel/i.test(error.errMsg || "") ? "已取消微信收款授权" : error.message || "微信授权未完成，请刷新后重试",
        icon: "none"
      });
    } finally {
      this.authorizing = false;
      if (!this.disposed && owner === this.currentOwner()) {
        this.setData({ submitting: false });
        if (!jumped && !this.wasHidden) await this.load();
      }
    }
  },
  amountError(raw) {
    if (!String(raw || "").trim()) return "";
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return "请输入有效的提现金额";
    const context = this.withdrawContext || {};
    if (amount < Number(context.minAmount || 1)) return `最低提现金额为 ¥${Number(context.minAmount || 1)}`;
    if (amount > Number(context.maxAmount || 500)) return `单笔提现金额不能超过 ¥${Number(context.maxAmount || 500)}`;
    if (amount > Number(context.balance || 0)) return "提现金额不能超过可提现余额";
    if (Number(context.dailyAmountLimit || 0) > 0 && Number(context.usedToday || 0) + amount > Number(context.dailyAmountLimit) + 0.005) return "提现金额超过今日剩余额度";
    return "";
  },
  exchangeError(raw) {
    if (!String(raw || "").trim()) return "";
    const points = Number(raw), context = this.exchangeContext || {};
    if (!Number.isSafeInteger(points) || points <= 0) return "请输入整数积分";
    if (points < Number(context.minimum || 100)) return `最低兑换 ${Number(context.minimum || 100)} 积分`;
    if (points > Number(context.points || 0)) return "积分余额不足";
    const amount = points * Number(context.rate || 0.1);
    return amount < 0.01 ? "兑换金额不足 0.01 元" : "";
  },
  input(e) { this.setData({ amount: e.detail.value, withdrawAmountError: this.amountError(e.detail.value) }); },
  exchangeInput(e) {
    const value = Number(e.detail.value), rate = Number(this.exchangeContext?.rate || 0);
    this.setData({ exchangeAmount: e.detail.value, exchangePreview: Number.isFinite(value) && value > 0 ? (value * rate).toFixed(2) : "0.00", exchangePointsError: this.exchangeError(e.detail.value) });
  },
  text(e) { this.setData({ content: e.detail.value }); },
  async confirmTransfer(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const transfer = await request(`/api/withdrawals/${encodeURIComponent(id)}/transfer-package`);
      if (!transfer.package || !transfer.mchId) throw new Error("提现确认信息不完整，请联系客服");
      if (typeof wx.requestMerchantTransfer !== "function") throw new Error("当前微信版本不支持商户转账确认，请升级微信后重试");
      await new Promise((resolve, reject) => wx.requestMerchantTransfer({
        mchId: transfer.mchId,
        appId: wx.getAccountInfoSync?.().miniProgram?.appId,
        package: transfer.package,
        success: resolve,
        fail: reject
      }));
      wx.showToast({ title: "已提交收款确认", icon: "success" });
      await this.load();
    } catch (error) { wx.showToast({ title: error.errMsg || error.message || "确认收款失败", icon: "none" }); }
    finally { this.setData({ submitting: false }); }
  },
  async submit() {
    if (this.data.submitting) return;
    if (this.type === "withdraw" && (this.disposed || this.data.loading || this.data.error)) return;
    if (this.type === "withdraw" && (this.data.balanceBelowMinimum || this.data.withdrawLimitReached || !this.data.amount || this.amountError(this.data.amount))) {
      const error = this.data.balanceBelowMinimum ? "可提现余额未达到最低提现金额" : this.data.withdrawLimitReached ? "今日提现次数或额度已用完" : this.amountError(this.data.amount) || "请输入提现金额";
      wx.showToast({ title: error, icon: "none" });
      return;
    }
    if (this.type === "withdraw" && this.data.authorizationRequired !== false && this.data.authorizationStatus !== "active") {
      wx.showToast({ title: "请先完成微信收款授权并刷新状态", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      if (this.type === "pointExchange") {
        const error = this.exchangeError(this.data.exchangeAmount);
        if (!this.data.exchangeAmount || error) throw new Error(error || "请输入兑换积分");
        await request("/api/points/exchange-balance", { method: "POST", data: { points: Number(this.data.exchangeAmount), idempotencyKey: `pbe:${Date.now()}:${Math.random().toString(36).slice(2)}` } });
      } else if (this.type === "withdraw") {
        const amount = Number(this.data.amount || 0), owner = this.currentOwner();
        if (!this.withdrawAttempt || this.withdrawAttempt.owner !== owner || this.withdrawAttempt.amount !== amount) this.withdrawAttempt = { owner, amount, key: `wd:${Date.now()}:${Math.random().toString(36).slice(2)}` };
        await request("/api/withdrawals", { method: "POST", data: { amount, channel: "wechat", idempotencyKey: this.withdrawAttempt.key } });
        this.withdrawAttempt = null;
      }
      else await request("/api/tickets", { method: "POST", data: { type: this.type === "customerService" ? "customer_service" : this.type, subject: this.data.title, content: this.data.content || "" } });
      wx.showToast({ title: this.type === "pointExchange" ? "兑换成功" : "提交成功" }); this.setData({ amount: "", exchangeAmount: "", exchangePreview: "0.00", content: "" }); await this.load();
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } finally { this.setData({ submitting: false }); }
  }
});
