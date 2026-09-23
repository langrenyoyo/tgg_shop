const { request } = require("../../utils/api");
Page({
  data: {
    categories: [], tasks: [], currentCid: "", search: "", page: 1, hasMore: true,
    activeTab: "tasks", loading: false, error: "",
    submissions: [], visibleSubmissions: [], recordStatus: "",
    recordFilters: [{ id: "", name: "全部" }, { id: "reviewing", name: "审核中" }, { id: "approved", name: "已通过" }, { id: "rejected", name: "已驳回" }]
  },
  onShow() {
    const view = wx.getStorageSync("tgg_task_view");
    if (view === "submissions") { this.setData({ activeTab: view }); wx.removeStorageSync("tgg_task_view"); }
    this.load();
  },
  onUnload() { this.loadVersion = (this.loadVersion || 0) + 1; },
  async load() {
    const append = Boolean(this.appendNext);
    this.appendNext = false;
    const page = append ? this.data.page + 1 : 1;
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    this.setData({ loading: true, error: "", ...(append ? {} : { tasks: [], submissions: [], visibleSubmissions: [], categories: [] }) });
    try {
      if (this.data.activeTab === "submissions") {
        const rows = await request("/api/submissions?page=" + page + "&status=" + encodeURIComponent(this.data.recordStatus || "All"));
        if (version !== this.loadVersion) return;
        const labels = { reviewing: "审核中", approved: "已通过", rejected: "已驳回" };
        const submissions = rows.map(item => ({ ...item, statusText: labels[item.status] || item.status, dateText: (item.createdAt || "").replace("T", " ").slice(0, 16) }));
        this.setData({ submissions: append ? this.data.submissions.concat(submissions) : submissions, page, hasMore: rows.length > 0 }, () => this.updateRecords());
      } else {
        const query = "?page=" + page + "&count=20&c_id=" + encodeURIComponent(this.data.currentCid) + "&search=" + encodeURIComponent(this.data.search.trim());
        const [categories, tasks] = await Promise.all([request("/api/task-types"), request("/api/tasks" + query)]);
        if (version !== this.loadVersion) return;
        // The provider may cap count below 20 and does not return a total.
        // Only an empty page confirms that all tasks have been fetched.
        this.setData({ categories: categories.map(item => ({ ...item, id: String(item.id) })), tasks: append ? this.data.tasks.concat(tasks) : tasks, page, hasMore: tasks.length > 0 });
      }
    } catch (error) {
      if (version === this.loadVersion) this.setData({ error: error.message || "加载失败，请重试" });
    } finally {
      if (version === this.loadVersion) this.setData({ loading: false });
    }
  },
  reload() { return this.load(); },
  onReachBottom() { this.loadMore(); },
  loadMore() { if (this.data.loading || !this.data.hasMore) return; this.appendNext = true; this.load(); },
  openRecord(e) { wx.navigateTo({ url: "/pages/submission/index?id=" + encodeURIComponent(e.currentTarget.dataset.id) }); },
  setSearch(e) { this.setData({ search: e.detail.value }); },
  setCategory(e) {
    const id = String(e.currentTarget.dataset.id);
    this.setData({ currentCid: this.data.currentCid === id ? "" : id }, () => this.load());
  },
  showTasks() { this.setData({ activeTab: "tasks" }, () => this.load()); },
  showSubmissions() { this.setData({ activeTab: "submissions" }, () => this.load()); },
  filterRecords(e) { this.appendNext = false; this.setData({ recordStatus: e.currentTarget.dataset.id, submissions: [], visibleSubmissions: [], page: 1 }, () => this.load()); },
  updateRecords() { this.setData({ visibleSubmissions: this.data.submissions.filter(item => !this.data.recordStatus || item.status === this.data.recordStatus) }); },
  openTask(e) { wx.navigateTo({ url: "/pages/task-detail/index?id=" + encodeURIComponent(e.currentTarget.dataset.id) }); },
  openSignin() { wx.navigateTo({ url: "/pages/signin/index" }); },
  openInvite() { wx.navigateTo({ url: "/pages/invite/index" }); }
});
