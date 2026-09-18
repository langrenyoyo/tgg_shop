const { nextId } = require("../data/store");
const ledger = require("../repositories/ledger-repository");

function releaseOrderPoints(state, order) {
  if (!order.pointsReserved) return;
  const user = state.users.find(item => item.id === order.userId);
  if (!user) throw new Error("积分预占用户不存在");
  const key = `order:${order.id}:release_points`;
  if (!state.pointLedger.some(item => item.idempotencyKey === key)) {
    user.points += order.pointAmount;
    ledger.addPointEntry(state, { id: nextId("pt"), userId: user.id, changeType: "shopping_hold_release", direction: "in", points: order.pointAmount, balanceAfter: user.points, bizNo: order.id, idempotencyKey: key, createdAt: new Date().toISOString() });
  }
  order.pointsReserved = false;
}
module.exports = { releaseOrderPoints };
