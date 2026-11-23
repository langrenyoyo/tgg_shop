const crypto = require("node:crypto");
const IDLE_MS = 30 * 60 * 1000;

function pickingLease(state, record) {
  // Historical claims have no timestamp on the record. Use their persisted
  // claim log; unknown times never qualify for automatic takeover.
  const latest = (state.stationOperationLogs || []).filter(row => row.orderId === record.orderId && row.operatorId === record.pickerId && ["picking.claim", "picking.takeover"].includes(row.action) && row.result === "success")
    .reduce((time, row) => Math.max(time, Date.parse(row.createdAt) || 0), 0);
  const claimedAt = Math.max(Date.parse(record.pickingClaimedAt) || 0, latest);
  return {
    expired: Boolean(record.pickerId && claimedAt && Date.now() - claimedAt >= IDLE_MS),
    version: crypto.createHash("sha256").update(JSON.stringify([record.orderId, record.pickerId, record.stationStatus, claimedAt])).digest("hex")
  };
}

module.exports = { pickingLease };
