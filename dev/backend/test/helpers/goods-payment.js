const assert = require("node:assert/strict");
const { createOrder } = require("../../src/domain/rules");
const payments = require("../../src/services/payment-service");

module.exports = function goodsPayment(state, options = {}) {
  const result = createOrder(state, "u_1001", { paymentMode: "cash", items: [{ productId: "p_apple", quantity: 1 }] });
  assert.equal(result.ok, true, result.error);
  const payment = payments.createGoodsPayment(state, result.order.id, { channel: "lfwin_wechat_mini", ...options });
  assert.equal(payment.ok, true, payment.error);
  return payment.payment;
};
