const { request } = require("../../utils/api");
const TITLES = { payments: "支付记录", ranking: "积分排行榜", withdraw: "提现", customerService: "在线客服", feedback: "意见反馈", business: "商务合作", recruiting: "招聘岗位", pickupSite: "自提点" };
Page({
  data: { type: "payments", title: "支付记录", rows: [], balance: 0, config: {}, loading: true, error: "", submitting: false },
  onLoad(query) { this.type = query.type || "payments"; this.setData({ type: this.type, title: TITLES[this.type] || "用户服务" }); this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      if (this.type === "payments") this.setData({ rows: await request("/api/payments") });
      else if (this.type === "ranking") this.setData({ rows: (await request("/api/ranking")).rows || [] });
      else if (this.type === "withdraw") { const [user, config, rows] = await Promise.all([request("/api/me"), request("/api/config"), request("/api/withdrawals")]); this.setData({ balance: user.withdrawableBalance || 0, config, rows }); }
      else if (this.type === "pickupSite") this.setData({ rows: await request("/api/pickup-sites") });
      else this.setData({ rows: (await request("/api/tickets")).filter(item => item.type === this.type || (this.type === "customerService" && item.type === "customer_service")) });
    } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); }
  },
  input(e) { this.setData({ amount: e.detail.value }); },
  text(e) { this.setData({ content: e.detail.value }); },
  async submit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      if (this.type === "withdraw") await request("/api/withdrawals", { method: "POST", data: { amount: Number(this.data.amount || 0), channel: "wechat" } });
      else await request("/api/tickets", { method: "POST", data: { type: this.type === "customerService" ? "customer_service" : this.type, subject: this.data.title, content: this.data.content || "" } });
      wx.showToast({ title: "提交成功" }); this.setData({ amount: "", content: "" }); await this.load();
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } finally { this.setData({ submitting: false }); }
  }
});
