// Read-only diagnostics. Never derive a replacement balance from incomplete history.
function reconcilePoints(state) {
  const groups = new Map((state.users || []).map(user => [user.id, { user, entries: [], issues: new Set() }]));
  const keys = new Map(), ids = new Map();
  for (const entry of state.pointLedger || []) {
    if (!groups.has(entry.userId)) groups.set(entry.userId, { entries: [], issues: new Set(["missing_user"]) });
    const group = groups.get(entry.userId);
    group.entries.push(entry);
    for (const [map, value, issue] of [[keys, entry.idempotencyKey, "duplicate_key"], [ids, entry.id, "duplicate_id"]]) {
      if (!value) { group.issues.add("missing_identity"); continue; }
      if (map.has(value)) { group.issues.add(issue); map.get(value).issues.add(issue); }
      else map.set(value, group);
    }
  }
  const rows = [];
  for (const [userId, group] of groups) {
    const { user, entries, issues } = group;
    if (user && (!Number.isSafeInteger(user.points) || user.points < 0)) issues.add("invalid_balance");
    if (!entries.length) issues.add("no_history");
    const ordered = entries.map(entry => ({ entry, time: Date.parse(entry.createdAt) })).sort((a, b) => a.time - b.time);
    const valid = ordered.every(({ entry, time }) => Number.isFinite(time) && ["in", "out"].includes(entry.direction) && Number.isSafeInteger(entry.points) && entry.points >= 0 && Number.isSafeInteger(entry.balanceAfter) && entry.balanceAfter >= 0 && Number.isSafeInteger(before(entry)) && before(entry) >= 0);
    if (!valid) issues.add("invalid_entry");
    const tied = ordered.some((item, index) => index > 0 && item.time === ordered[index - 1].time);
    if (tied) issues.add("timestamp_tie");
    // Stores do not persist a posting sequence. Equal timestamps cannot establish order.
    if (valid && !tied) {
      for (let index = 1; index < ordered.length; index++) {
        if (before(ordered[index].entry) !== ordered[index - 1].entry.balanceAfter) issues.add("broken_chain");
      }
    }
    const latest = ordered.at(-1);
    const latestUnique = latest && (!ordered[ordered.length - 2] || latest.time !== ordered[ordered.length - 2].time);
    const expectedBalance = valid && latestUnique ? latest.entry.balanceAfter : null;
    if (user && expectedBalance !== null && user.points !== expectedBalance) issues.add("balance_mismatch");
    const problems = [...issues];
    const status = problems.some(issue => !["no_history", "timestamp_tie"].includes(issue)) ? "mismatch" : problems.length ? "unverified" : "consistent";
    rows.push({ userId, actualBalance: Number.isSafeInteger(user?.points) ? user.points : null, expectedBalance, entryCount: entries.length, status, issues: problems });
  }
  return { scope: "stored_history", openingBalanceVerified: false, rows, summary: {
    consistent: rows.filter(row => row.status === "consistent").length,
    mismatch: rows.filter(row => row.status === "mismatch").length,
    unverified: rows.filter(row => row.status === "unverified").length
  } };
}

function before(entry) { return entry.balanceAfter + (entry.direction === "in" ? -entry.points : entry.points); }
module.exports = { reconcilePoints };
