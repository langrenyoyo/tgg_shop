const cart = require("./cart");

function quantities() {
  return Object.fromEntries(cart.read().map(item => [item.productId, item.quantity]));
}

function change(page, product, delta) {
  if (!product || ![-1, 1].includes(delta) || page.data.loading || page.data.error || page.disposed) return;
  if (product.category === "买商品送会员") return;
  try {
    // Read the active account's cart on every tap rather than a stale page snapshot.
    if (delta > 0) {
      if (product.status !== "on" || !Number.isSafeInteger(product.stock) || product.stock < 1) throw new Error("商品已下架或库存不足");
      cart.add(product);
    } else {
      const items = cart.read().map(item => item.productId === product.id ? { ...item, quantity: item.quantity - 1 } : item).filter(item => item.quantity > 0);
      cart.write(items);
    }
    page.setData({ cartQuantities: quantities() });
  } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
}

function buyGift(page, product) {
  if (!product || product.category !== "买商品送会员" || page.data.loading || page.data.error || page.data.navigating || page.disposed) return;
  if (product.status !== "on" || !Number.isSafeInteger(product.stock) || product.stock < 1) {
    return wx.showToast({ title: "商品已下架或库存不足", icon: "none" });
  }
  if (!product.supportsCash || product.purePointsOnly || !(product.membershipGiftDays > 0)) {
    return wx.showToast({ title: "礼包暂不可购买，请刷新后重试", icon: "none" });
  }
  const loggedIn = Boolean(wx.getStorageSync("tgg_token") && wx.getStorageSync("tgg_user")?.id);
  page.setData({ navigating: true });
  const fail = () => {
    if (!page.disposed) {
      page.setData({ navigating: false });
      wx.showToast({ title: "页面打开失败，请重试", icon: "none" });
    }
  };
  try {
    // 独立结算一件礼包，不合并或清空用户购物车。
    if (loggedIn) cart.writeCheckout([{ productId: product.id, quantity: 1 }]);
    wx.navigateTo({ url: loggedIn ? "/pages/checkout/index" : "/pages/login/index", fail });
  } catch { fail(); }
}

module.exports = { quantities, change, buyGift };
