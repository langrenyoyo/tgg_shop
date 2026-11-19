// Enqueued alongside the local entitlement and persisted by its caller.
// One latest target per user prevents delayed renewals from adding time twice.
function enqueueMembershipSync(state, user, reason, now = Date.now()) {
  state.config ||= {};
  state.config.pospalIntegration ||= {};
  const jobs = state.config.pospalIntegration.membershipSyncJobs ||= {};
  const previous = jobs[user.id];
  const memberUntil = user.memberUntil || null;
  jobs[user.id] = {
    userId: user.id, revision: (previous?.revision || 0) + 1,
    memberUntil, expiryDate: memberUntil ? expiryDate(memberUntil) : expiryDate(now),
    reason, status: "pending", attempts: 0, nextAttemptAt: null,
    account: previous?.account || null,
    createdAt: previous?.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(), lastError: null,
    lastSyncedAt: previous?.lastSyncedAt || null
  };
  return jobs[user.id];
}

// POSPAL uses a date without a zone. Always send Beijing time, independently
// of the host's timezone; precision is seconds on the provider API.
function expiryDate(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error("Invalid membership expiry");
  return new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
}

module.exports = { enqueueMembershipSync, expiryDate };
