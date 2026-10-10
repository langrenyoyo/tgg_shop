const cart = require("./cart");

function quantities() {
  return Object.fromEntries(cart.read().map(item => [item.productId, item.quantity]));
}

function change(page, product, delta) {
  if (!product || ![-1, 1].includes(delta) || page.data.loading || page.data.error || page.disposed) return;
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

module.exports = { quantities, change };
