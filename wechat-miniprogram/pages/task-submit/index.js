const { request, uploadFile } = require("../../utils/api");

Page({
  data: {
    task: null,
    fields: [],
    form: {},
    images: [],
    needImages: false,
    loading: false
  },

  onLoad(query) {
    this.taskId = query.id;
    this.load();
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
    const name = e.currentTarget.dataset.name;
    this.setData({ [`form.${name}`]: e.detail.value });
  },

  async chooseImage() {
    try {
      const res = await wx.chooseImage({ count: 3 - this.data.images.length });
      const uploaded = [];
      for (const filePath of res.tempFilePaths) {
        const file = await uploadFile(filePath);
        uploaded.push(file.path || file.url);
      }
      this.setData({ images: this.data.images.concat(uploaded) });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  clearImages() {
    this.setData({ images: [] });
  },

  async submit() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const payload = {
        ...this.data.form,
        images: this.data.images.join(",")
      };
      const res = await request(`/api/tasks/${this.taskId}/submit`, {
        method: "POST",
        data: payload
      });
      wx.showToast({ title: "提交成功", icon: "success" });
      wx.redirectTo({ url: "/pages/me/index?tab=submissions" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
