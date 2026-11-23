const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jsQR = require("jsqr");
const { createPickupQr } = require("../../../../wechat-miniprogram/utils/pickup-qr");

const order = { id: "TGG_1795400000000_A1B2C3", fulfillmentType: "pickup", status: "paid", fulfillmentStatus: "pending_pickup", pickupCode: "123456", userId: "private-user", phone: "private-phone" };
function decode(qr, scale) {
  const size = Math.round(qr.size * scale), rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (const run of qr.runs) {
    for (let y = Math.round(run.y * scale); y < Math.round((run.y + qr.cellSize) * scale); y++) {
      for (let x = Math.round(run.x * scale); x < Math.round((run.x + run.width) * scale); x++) {
        const i = (y * size + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
  }
  const result = jsQR(rgba, size, size);
  assert.ok(result, "Independent QR decoder must recognize the rendered native rectangles");
  return result.data;
}

test("rendered pickup QR decodes on narrow and standard screens with only order ID and six-digit code", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../frontend/station/scanner.js"), "utf8");
  const { parseScan } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  for (const id of [order.id, "legacy-order_1", "A".repeat(100)]) {
    const qr = createPickupQr({ ...order, id });
    assert.ok(qr.size <= 480);
    for (const scale of [320 / 750, 0.5, 1]) {
      const text = decode(qr, scale);
      assert.deepEqual(JSON.parse(text), { orderId: id, pickupCode: order.pickupCode });
      assert.deepEqual(parseScan(text, "pickupCode"), { orderId: id, pickupCode: order.pickupCode });
      assert.throws(() => parseScan(text, "pickupCode", "another-order"), /不属于当前订单/);
    }
  }
});

test("QR is unavailable for non-pickup, unpaid, refunded, fulfilled and malformed records", () => {
  for (const change of [{ fulfillmentType: "delivery" }, { status: "pending_payment" }, { status: "refunding" }, { status: "refunded" }, { status: "cancelled" }, { status: "closed" }, { status: "completed" }, { fulfillmentStatus: "picked_up" }, { id: "" }, { id: "x".repeat(101) }, { id: "https://example.com" }, { pickupCode: "12345" }, { pickupCode: 123456 }, { pickupCode: null }]) {
    assert.equal(createPickupQr({ ...order, ...change }), null);
  }
  assert.equal(createPickupQr(null), null);
});
