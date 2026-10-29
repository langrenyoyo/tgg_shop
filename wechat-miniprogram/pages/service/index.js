const { request } = require("../../utils/api");
const TITLES = { payments: "支付记录", ranking: "积分排行榜", withdraw: "提现", customerService: "在线客服", feedback: "意见反馈", business: "商务合作", recruiting: "代理申请", pickupSite: "自提点" };
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
  data: { type: "payments", title: "支付记录", rows: [], balance: 0, config: {}, withdrawRules: {}, withdrawNoticeLines: [], withdrawLimitReached: false, balanceBelowMinimum: false, withdrawAmountError: "", loading: true, error: "", needLogin: false, submitting: false },
  onLoad(query) { this.type = query.type || "payments"; this.setData({ type: this.type, title: TITLES[this.type] || "用户服务" }); this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      if (this.type === "payments") this.setData({ rows: await request("/api/payments") });
      else if (this.type === "ranking") this.setData({ rows: (await request("/api/ranking")).rows || [] });
      else if (this.type === "withdraw") {
        const [user, config, rows] = await Promise.all([request("/api/me"), request("/api/config"), request("/api/withdrawals")]);
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
          withdrawAmountError: this.amountError(this.data.amount),
          rows: safeRows
        });
      }
      else if (this.type === "pickupSite") this.setData({ rows: await request("/api/pickup-sites") });
      else this.setData({ rows: (await request("/api/tickets")).filter(item => item.type === this.type || (this.type === "customerService" && item.type === "customer_service")) });
    } catch (error) { this.setData({ error: error.message, needLogin: error.statusCode === 401 }); } finally { this.setData({ loading: false }); }
  },
  login() { wx.navigateTo({ url: "/pages/login/index" }); },
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
  input(e) { this.setData({ amount: e.detail.value, withdrawAmountError: this.amountError(e.detail.value) }); },
  text(e) { this.setData({ content: e.detail.value }); },
  async submit() {
    if (this.data.submitting) return;
    if (this.type === "withdraw" && (this.data.balanceBelowMinimum || this.data.withdrawLimitReached || !this.data.amount || this.amountError(this.data.amount))) {
      const error = this.data.balanceBelowMinimum ? "可提现余额未达到最低提现金额" : this.data.withdrawLimitReached ? "今日提现次数或额度已用完" : this.amountError(this.data.amount) || "请输入提现金额";
      wx.showToast({ title: error, icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      if (this.type === "withdraw") await request("/api/withdrawals", { method: "POST", data: { amount: Number(this.data.amount || 0), channel: "wechat" } });
      else await request("/api/tickets", { method: "POST", data: { type: this.type === "customerService" ? "customer_service" : this.type, subject: this.data.title, content: this.data.content || "" } });
      wx.showToast({ title: "提交成功" }); this.setData({ amount: "", content: "" }); await this.load();
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } finally { this.setData({ submitting: false }); }
  }
});
