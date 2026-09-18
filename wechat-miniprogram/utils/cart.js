function key() { return "tgg_cart_" + (wx.getStorageSync("tgg_user")?.id || "guest"); }
function read() { return wx.getStorageSync(key()) || []; }
function write(items) { wx.setStorageSync(key(), items); }
function checkoutKey() { return "tgg_checkout_" + (wx.getStorageSync("tgg_user")?.id || "guest"); }
function readCheckout() {
  const draft = wx.getStorageSync(checkoutKey());
  return Array.isArray(draft) ? draft : draft?.items || [];
}
function writeCheckout(items, fromCart = false) {
  const previous = wx.getStorageSync(checkoutKey());
  if (previous?.idempotencyKey && previous.fromCart === fromCart && JSON.stringify(previous.items) === JSON.stringify(items)) return;
  wx.setStorageSync(checkoutKey(), { items, fromCart, idempotencyKey: "checkout:" + Date.now() + ":" + Math.random().toString(36).slice(2) });
}
function checkoutIdempotencyKey() {
  const draft = wx.getStorageSync(checkoutKey());
  if (!draft?.idempotencyKey) writeCheckout(readCheckout());
  return wx.getStorageSync(checkoutKey()).idempotencyKey;
}
function completeCheckout(idempotencyKey) {
  const draft = wx.getStorageSync(checkoutKey());
  if (!draft || draft.idempotencyKey !== idempotencyKey) return;
  if (draft.fromCart) {
    write(read().map(item => {
      const ordered = draft.items.find(row => row.productId === item.productId);
      return ordered ? { ...item, quantity: Math.max(0, item.quantity - ordered.quantity) } : item;
    }).filter(item => item.quantity > 0));
  }
  clearCheckout();
}
function clearCheckout() { wx.removeStorageSync(checkoutKey()); }
function readCheckoutAttempt() { return wx.getStorageSync(checkoutKey())?.attempt || null; }
function writeCheckoutAttempt(idempotencyKey, attempt) {
  const draft = wx.getStorageSync(checkoutKey());
  if (!draft || draft.idempotencyKey !== idempotencyKey) throw new Error("结算草稿已变更，请重新结算");
  wx.setStorageSync(checkoutKey(), { ...draft, attempt });
}
function mergeGuestCart() {
  if (!wx.getStorageSync("tgg_user")?.id) return;
  const guest = wx.getStorageSync("tgg_cart_guest") || [];
  if (!guest.length) return;
  const items = read().map(item => ({ ...item }));
  for (const item of guest) {
    if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1) continue;
    const existing = items.find(row => row.productId === item.productId);
    if (existing) {
      const total = existing.quantity + item.quantity;
      if (Number.isSafeInteger(total)) existing.quantity = total;
      existing.selected = existing.selected || item.selected;
    } else items.push({ ...item });
  }
  write(items);
  wx.removeStorageSync("tgg_cart_guest");
}
function add(product, quantity = 1) {
  const items = read();
  const existing = items.find(item => item.productId === product.id);
  const count = (existing?.quantity || 0) + quantity;
  if (!Number.isSafeInteger(count) || count < 1 || count > product.stock) throw new Error("库存不足");
  if (existing) existing.quantity = count; else items.push({ productId: product.id, quantity: count, selected: true });
  write(items);
}
module.exports = { read, write, add, readCheckout, writeCheckout, clearCheckout, mergeGuestCart, checkoutIdempotencyKey, completeCheckout, readCheckoutAttempt, writeCheckoutAttempt };
