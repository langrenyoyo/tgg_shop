const { request, uploadFile } = require("../../utils/api");

Page({
  data: {
    task: null,
    fields: [],
    form: {},
    images: [],
    needImages: false,
    loading: false,
    uploading: false,
    awaitingResult: false
  },

  onLoad(query) {
    this.taskId = query.id;
    this.ownerId = wx.getStorageSync("tgg_user")?.id;
    this.attemptStorageKey = "tgg_task_attempt_" + (wx.getStorageSync("tgg_user")?.id || "guest") + "_" + this.taskId;
    const attempt = wx.getStorageSync(this.attemptStorageKey);
    this.idempotencyKey = attempt?.idempotencyKey || "task:" + Date.now() + ":" + Math.random().toString(36).slice(2);
    if (attempt) this.setData({ form: attempt.form || {}, images: attempt.images || [], awaitingResult: true });
    this.load();
  },

  openRecords() {
    wx.setStorageSync("tgg_task_view", "submissions");
    wx.switchTab({ url: "/pages/tasks/index" });
  },

  async load() {
    try {
      const task = await request(`/api/tasks/${this.taskId}`);
      const fields = (task.submitFields || task.option || []).map((name) => ({
        name,
        label: this.fieldLabel(name),
        type: name === "text2" ? "textarea" : "input"
      }));
      this.setData({
        task,
        fields,
        needImages: fields.some((item) => item.name === "imgea" || item.name === "images")
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  fieldLabel(name) {
    return ({ name: "姓名", mobile: "手机号", phone: "手机号", text1: "备注1", text2: "备注2", imgea: "截图", images: "截图" })[name] || name;
  },

  onInput(e) {
    if (this.data.loading || this.data.awaitingResult) return;
    const name = e.currentTarget.dataset.name;
    this.setData({ [`form.${name}`]: e.detail.value });
  },

  async chooseImage() {
    if (this.data.uploading || this.data.loading || this.data.awaitingResult) return;
    if (this.data.images.length >= 3) return wx.showToast({ title: "最多上传三张截图", icon: "none" });
    this.setData({ uploading: true });
    try {
      const res = await wx.chooseImage({ count: 3 - this.data.images.length });
      for (const filePath of res.tempFilePaths) {
        const file = await uploadFile(filePath);
        const url = file.path || file.url;
        if (!url) throw new Error("上传未返回图片地址，请重试");
        this.setData({ images: this.data.images.concat(url) });
      }
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ uploading: false }); }
  },

  clearImages() {
    if (this.data.uploading || this.data.loading || this.data.awaitingResult) return;
    this.setData({ images: [] });
  },

  async submit() {
    if (this.data.loading || this.data.uploading) return;
    if (!this.ownerId || this.ownerId !== wx.getStorageSync("tgg_user")?.id) return wx.showToast({ title: "请登录后重新打开提交页面", icon: "none" });
    if (!this.data.awaitingResult && (!this.data.task || this.data.task.paused || this.data.task.rewardValid === false)) return wx.showToast({ title: "任务不可提交，请核对奖励和任务状态", icon: "none" });
    for (const field of this.data.awaitingResult ? [] : this.data.fields) {
      if (["imgea", "images"].includes(field.name)) {
        if (!this.data.images.length) return wx.showToast({ title: "请上传截图", icon: "none" });
      } else if (!String(this.data.form[field.name] || "").trim()) {
        return wx.showToast({ title: "请填写" + field.label, icon: "none" });
      }
    }
    this.setData({ loading: true });
    try {
      const payload = {
        ...this.data.form,
        idempotencyKey: this.idempotencyKey,
        images: this.data.images.join(",")
      };
      wx.setStorageSync(this.attemptStorageKey, { idempotencyKey: this.idempotencyKey, form: this.data.form, images: this.data.images });
      this.setData({ awaitingResult: true });
      const res = await request(`/api/tasks/${this.taskId}/submit`, {
        method: "POST",
        data: payload
      });
      wx.removeStorageSync(this.attemptStorageKey);
      this.setData({ awaitingResult: false });
      wx.showToast({ title: "提交成功", icon: "success" });
      this.openRecords();
    } catch (error) {
      // These responses reject the request before registering a submission intent.
      // Network errors, 5xx and conflicts retain the original content for safe retry.
      if ([400, 404].includes(error.statusCode)) {
        wx.removeStorageSync(this.attemptStorageKey);
        this.setData({ awaitingResult: false });
      }
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
