const GIFT_CATEGORY = "买商品送会员";
const DAY = 86400000;

function isGiftProduct(product) {
  return Boolean(product && product.category === GIFT_CATEGORY && !product.purePointsOnly
    && product.supportsCash && Number.isInteger(product.membershipGiftDays)
    && product.membershipGiftDays > 0 && product.membershipGiftDays <= 365);
}

// The order snapshot is the durable grant identity; product edits cannot change it.
function grantMembership(state, order, now = Date.now()) {
  if (order.membershipGift || order.paymentMode !== "cash" || order.cashAmount <= 0
    || !["paid", "completed"].includes(order.status) || !(order.membershipGiftDays > 0)) return;
  const user = state.users.find(item => item.id === order.userId);
  if (!user) throw new Error("赠送会员的订单用户不存在");
  const start = Math.max(now, Date.parse(user.memberUntil) || 0);
  const end = start + order.membershipGiftDays * DAY;
  order.membershipGift = {
    idempotencyKey: `order:${order.id}:membership-gift`, days: order.membershipGiftDays,
    grantedAt: new Date(now).toISOString(), startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(), previousMemberUntil: user.memberUntil || null
  };
  user.memberUntil = new Date(end).toISOString();
  user.role = "member";
}

// Remove only the unused interval. Later gifts/paid renewals keep their duration.
function revokeMembership(state, order, now = Date.now()) {
  const gift = order.membershipGift;
  if (!gift || gift.revokedAt) return;
  const user = state.users.find(item => item.id === order.userId);
  if (!user) throw new Error("回收会员的订单用户不存在");
  const currentEnd = Date.parse(user.memberUntil) || 0;
  const start = Math.max(now, Date.parse(gift.startsAt));
  const end = Math.min(currentEnd, Date.parse(gift.endsAt));
  const removed = Math.max(0, end - start);
  if (removed > 0) {
    user.memberUntil = new Date(Math.max(now, currentEnd - removed)).toISOString();
    if (Date.parse(user.memberUntil) <= now) user.role = "normal";
    const shift = value => new Date(value <= start ? value : value >= end ? value - removed : start).toISOString();
    for (const other of state.orders) {
      const next = other.membershipGift;
      if (other.userId !== user.id || other.id === order.id || !next || next.revokedAt) continue;
      next.startsAt = shift(Date.parse(next.startsAt));
      next.endsAt = shift(Date.parse(next.endsAt));
    }
  }
  gift.revokedAt = new Date(now).toISOString();
  gift.revokedMilliseconds = removed;
  gift.memberUntilAfterRevoke = user.memberUntil;
}

module.exports = { GIFT_CATEGORY, isGiftProduct, grantMembership, revokeMembership };
