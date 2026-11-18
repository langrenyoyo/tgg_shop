const crypto = require("node:crypto");
const { saveState } = require("../data/store");

// Legacy accounts may predate invitation registration. Assign once, persist
// before exposing the code, and share the write across concurrent requests.
function createInviteIdentityService({ persist = saveState, randomBytes = crypto.randomBytes } = {}) {
  const pending = new WeakMap();
  return async function ensureInviteIdentity(state, user) {
    if (!user || user.status !== "active" || !state.users.includes(user)) throw new Error("请先登录");
    if (pending.has(user)) return pending.get(user);
    if (user.inviteCode) return user.inviteCode;
    const previous = user.inviteCode;
    let code;
    do { code = randomBytes(6).toString("hex").toUpperCase(); } while (state.users.some(item => item.inviteCode === code));
    user.inviteCode = code;
    const work = Promise.resolve().then(() => persist()).then(() => code).catch(error => {
      if (user.inviteCode === code) {
        if (previous === undefined) delete user.inviteCode;
        else user.inviteCode = previous;
      }
      throw error;
    }).finally(() => pending.delete(user));
    pending.set(user, work);
    return work;
  };
}

module.exports = { createInviteIdentityService, ensureInviteIdentity: createInviteIdentityService() };
