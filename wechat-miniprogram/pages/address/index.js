const { request } = require("../../utils/api");
Page({
  data: { rows: [], editing: null, loading: true, error: "", saving: false },
  onShow() { this.load(); },
  async load() { this.setData({ loading: true, error: "" }); try { this.setData({ rows: await request("/api/addresses") }); } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); } },
  edit(e) { const row = this.data.rows.find(item => item.id === e.currentTarget.dataset.id); this.setData({ editing: row || {} }); },
  input(e) { this.setData({ ["editing." + e.currentTarget.dataset.field]: e.detail.value }); },
  add() { this.setData({ editing: { receiverName: "", mobile: "", province: "", city: "", district: "", detail: "", isDefault: !this.data.rows.length } }); },
  async save() {
    if (!this.data.editing || this.data.saving) return;
    this.setData({ saving: true });
    try { const row = this.data.editing; const path = row.id ? "/api/addresses/" + row.id : "/api/addresses"; const saved = await request(path, { method: row.id ? "PATCH" : "POST", data: row }); this.setData({ editing: null, rows: row.id ? this.data.rows.map(item => item.id === saved.id ? saved : item) : [saved, ...this.data.rows] }); wx.showToast({ title: "地址已保存" }); }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); } finally { this.setData({ saving: false }); }
  },
  async remove(e) { try { await request("/api/addresses/" + e.currentTarget.dataset.id, { method: "DELETE" }); await this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } },
  async makeDefault(e) { try { await request("/api/addresses/" + e.currentTarget.dataset.id, { method: "PATCH", data: { isDefault: true } }); await this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } }
});
