const { getState } = require("../data/store");
const { withPersistence } = require("../data/persistence-scope");
const platform = require("./task-platform-client");
const { syncSubmission } = require("./task-service");

function createTaskSweep({ state = getState, sync = syncSubmission, persist = withPersistence, configured = platform.isConfigured, batchSize = 20 } = {}) {
  let running = null, stopped = false, cursor = null;
  async function sweep() {
    const result = { checked: 0, reconciled: 0, deferred: 0 };
    if (!configured() || stopped) return result;
    const candidates = state().submissions.filter(item => item.platform === "bounty_platform" && ["reviewing", "pending_review"].includes(item.status));
    const previous = candidates.findIndex(item => item.id === cursor);
    const start = previous < 0 ? 0 : (previous + 1) % candidates.length;
    const selected = candidates.slice(start).concat(candidates.slice(0, start)).slice(0, batchSize);
    for (const item of selected) {
      if (stopped) break;
      // Advance even on errors so one broken submission cannot starve the queue.
      cursor = item.id;
      const outcome = await persist(() => sync(state(), item.userId, item.id));
      result.checked++;
      if (outcome.ok) result.reconciled++;
      else result.deferred++;
    }
    return result;
  }
  return {
    run() {
      if (!running) running = sweep().finally(() => { running = null; });
      return running;
    },
    async stop() { stopped = true; if (running) await running; }
  };
}

module.exports = { createTaskSweep };
