const qrcode = require("../vendor/qrcode-generator/qrcode");

// Only order lookup data is encoded. The station still authenticates and verifies
// order status, site and packages on the server before completing a handover.
function createPickupQr(order) {
  if (order?.fulfillmentType !== "pickup" || order.status !== "paid" || order.fulfillmentStatus !== "pending_pickup") return null;
  if (typeof order.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(order.id) || typeof order.pickupCode !== "string" || !/^\d{6}$/.test(order.pickupCode)) return null;
  const code = qrcode(0, "M");
  code.addData(JSON.stringify({ orderId: order.id, pickupCode: order.pickupCode }), "Byte");
  code.make();
  const count = code.getModuleCount(), quiet = 4;
  const cellSize = Math.floor(480 / (count + quiet * 2));
  const runs = [];
  // Native views avoid external QR services, canvas readiness and image domains.
  // Combine adjacent dark modules to keep the rendered node count small.
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count;) {
      if (!code.isDark(row, col)) { col++; continue; }
      const start = col;
      while (col < count && code.isDark(row, col)) col++;
      runs.push({ id: runs.length, x: (start + quiet) * cellSize, y: (row + quiet) * cellSize, width: (col - start) * cellSize });
    }
  }
  return { size: (count + quiet * 2) * cellSize, cellSize, runs };
}

module.exports = { createPickupQr };
