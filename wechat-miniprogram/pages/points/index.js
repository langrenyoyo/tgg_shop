const { request } = require("../../utils/api");
const TYPES = ["", "task_reward", "signin_streak", "lottery", "invite_commission", "exchange_deduct", "shopping_hold", "shopping_hold_release", "refund_return", "invite_reward", "shopping_deduct", "manual_adjust", "monthly_reward", "monthly_reward_reversal"];
const LABELS = { task_reward: "任务奖励", signin: "签到", signin_streak: "连续签到奖励", lottery: "抽奖", invite_commission: "邀请提成", invite_reward: "邀请奖励", exchange_deduct: "积分兑换", shopping_hold: "待支付订单预占", shopping_hold_release: "取消订单返还", shopping_deduct: "购物扣减", refund_return: "退款返还", manual_adjust: "人工调整", monthly_reward: "月度奖励", monthly_reward_reversal: "月度奖励撤回" };

Page({
  data: {
    ledger: [], total: 0, type: "", direction: "", page: 0, hasMore: false,
    typeIndex: 0, directionIndex: 0, loading: false, error: "", balance: null,
    typeLabels: ["全部", "任务奖励", "连续签到奖励", "抽奖", "邀请提成", "积分兑换", "订单预占", "取消返还", "退款返还", "邀请奖励", "购物扣减", "人工调整", "月度奖励", "月度奖励撤回"],
    directionLabels: ["全部", "收入", "支出"]
  },

  onShow() {
    this.load();
  },
  onUnload() { this.version = (this.version || 0) + 1; },

  async load(append = false) {
    append = append === true;
    const version = this.version = (this.version || 0) + 1;
    const owner = wx.getStorageSync("tgg_user")?.id;
    if (owner !== this.ownerId) append = false;
    this.ownerId = owner;
    if (!append) this.setData({ ledger: [], balance: null, page: 0, total: 0, hasMore: false });
    if (!owner || !wx.getStorageSync("tgg_token")) { this.setData({ loading: false, error: "请登录后查看积分流水" }); return; }
    const current = () => version === this.version && owner === wx.getStorageSync("tgg_user")?.id;
    const page = append ? this.data.page + 1 : 1;
    this.setData({ loading: true, error: "" });
    try {
      const query = `?page=${page}&count=20&type=${encodeURIComponent(this.data.type)}&direction=${encodeURIComponent(this.data.direction)}`;
      const [result, user] = await Promise.all([request("/api/points-ledger" + query), request("/api/me")]);
      if (!current()) return;
      const rows = result.rows.map(item => ({ ...item, label: LABELS[item.changeType] || item.changeType }));
      this.setData({ ledger: append ? this.data.ledger.concat(rows) : rows, page, total: result.total, hasMore: page * result.count < result.total, balance: user.points });
    } catch (error) {
      if (current()) this.setData({ error: error.message });
    } finally {
      if (version === this.version) this.setData({ loading: false });
    }
  },
  setType(e) { const index = Number(e.detail.value); this.setData({ type: TYPES[index] || "", typeIndex: index, page: 1 }, () => this.load()); },
  setDirection(e) { const index = Number(e.detail.value); this.setData({ direction: ["", "in", "out"][index] || "", directionIndex: index, page: 1 }, () => this.load()); },
  more() { if (!this.data.hasMore || this.data.loading) return; this.load(true); },
  goLogin() { wx.navigateTo({ url: "/pages/login/index" }); },
  openSource(e) {
    if (this.ownerId !== wx.getStorageSync("tgg_user")?.id) { this.load(); return; }
    const source = this.data.ledger[e.currentTarget.dataset.index]?.source;
    if (!source) return;
    const pages = { order: "order-detail", submission: "submission", invite: "invite", signin: "signin" };
    if (pages[source.type]) wx.navigateTo({ url: `/pages/${pages[source.type]}/index${source.id ? '?id=' + encodeURIComponent(source.id) : ''}` });
  }
});
