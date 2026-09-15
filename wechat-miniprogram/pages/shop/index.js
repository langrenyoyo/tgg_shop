const { request } = require("../../utils/api");
Page({data:{products:[]},onShow(){request("/api/products").then(p=>this.setData({products:Array.isArray(p)?p:p.products||[]})).catch(e=>wx.showToast({title:e.message,icon:"none"}));},open(e){wx.navigateTo({url:`/pages/task-detail/index?id=${e.currentTarget.dataset.id}&type=product`});}});
